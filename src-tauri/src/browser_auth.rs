use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

/// What the shell needs in order to send the browser somewhere useful.
pub struct Handoff {
    pub port: u16,
    pub state: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum HandoffError {
    /// The request did not carry the nonce this listener minted. Discard it:
    /// something other than our own browser tab is talking to this port.
    StateMismatch,
    TimedOut,
}

/// Why `begin` could not start the handoff.
///
/// Kept distinct from `HandoffError` (which is about the *callback* once the
/// listener is up) and distinct internally between its two variants, rather
/// than collapsing both into `std::io::Error`: a bind failure (port
/// unavailable, no loopback interface) and an entropy failure (no system
/// CSPRNG) are different failure domains, and a caller — Task 5's Tauri
/// command — should be able to tell them apart instead of pattern-matching an
/// `io::ErrorKind::Other` string to recover which one happened.
#[derive(Debug)]
pub enum BeginError {
    /// The loopback socket could not be bound or inspected.
    Bind(std::io::Error),
    /// The OS CSPRNG could not fill the nonce buffer. Fatal to the flow: see
    /// `mint_state`.
    Entropy(String),
}

impl std::fmt::Display for BeginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BeginError::Bind(err) => write!(f, "failed to bind the loopback listener: {err}"),
            BeginError::Entropy(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for BeginError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            BeginError::Bind(err) => Some(err),
            BeginError::Entropy(_) => None,
        }
    }
}

impl From<std::io::Error> for BeginError {
    fn from(err: std::io::Error) -> Self {
        BeginError::Bind(err)
    }
}

/// The page shown in the browser tab once the token is in hand.
const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Signed in</title>\
<body style=\"font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0\">\
<p>Signed in. You can close this tab and return to Chroneli.</p>";

/// Pulls the token out of a callback request line, refusing anything whose
/// `state` is not ours.
///
/// Pure and separately tested because this is the security boundary: it is the
/// only thing between a local process that guessed the port and a live
/// session. Everything it can get wrong — parameter order, percent encoding, a
/// missing nonce, the browser's unprompted /favicon.ico — is reachable from a
/// unit test without binding a socket.
pub fn parse_callback(
    request_line: &str,
    expected_state: &str,
) -> Result<String, HandoffError> {
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or(HandoffError::StateMismatch)?;
    let query = path
        .strip_prefix("/callback?")
        .ok_or(HandoffError::StateMismatch)?;

    let mut token = None;
    let mut state = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        match key {
            "token" => token = Some(percent_decode(value)),
            "state" => state = Some(percent_decode(value)),
            _ => {}
        }
    }

    // Compared before the token is looked at, so a caller who does not know the
    // nonce learns nothing about whether their token parsed.
    if state.as_deref() != Some(expected_state) {
        return Err(HandoffError::StateMismatch);
    }
    token
        .filter(|t| !t.is_empty())
        .ok_or(HandoffError::StateMismatch)
}

/// `application/x-www-form-urlencoded` decoding: `+` is a space, `%XX` a byte.
fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A 256-bit nonce from the operating system's CSPRNG.
///
/// This value is the only thing standing between a local process that guessed
/// the port and a token that grants a full session, so it must not be
/// PREDICTABLE — which rules out anything derived from the clock. A nonce
/// seeded from the current nanosecond looks random and is not: an attacker who
/// knows roughly when sign-in began searches a very small space.
///
/// `getrandom` rather than `rand`: it is already in this tree transitively,
/// it is a thin wrapper over the OS entropy source, and one buffer fill is the
/// entire requirement.
///
/// A failure here must be fatal to the flow rather than papered over with a
/// weaker fallback — an unguessable nonce is the security property, and
/// continuing without one silently removes it.
fn mint_state() -> Result<String, BeginError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| BeginError::Entropy(format!("no system entropy for a sign-in nonce: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Binds a loopback port and waits, on its own thread, for one callback.
///
/// Returns as soon as the port is known so the caller can put it in the URL it
/// opens; the token arrives later on the channel.
///
/// `127.0.0.1` explicitly rather than `localhost` — RFC 8252 §8.3 warns the
/// name can resolve to a non-loopback interface, which would put a session
/// token on the network.
pub fn begin(
    timeout: Duration,
) -> Result<(Handoff, Receiver<Result<String, HandoffError>>), BeginError> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;
    let state = mint_state()?;
    let (tx, rx) = channel();

    let expected = state.clone();
    std::thread::spawn(move || {
        // A deadline rather than a blocking accept, so a browser that never
        // comes back cannot strand the thread or hold the port forever.
        let deadline = Instant::now() + timeout;
        loop {
            if Instant::now() >= deadline {
                let _ = tx.send(Err(HandoffError::TimedOut));
                return;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    if let Some(token) = handle(stream, &expected) {
                        let _ = tx.send(Ok(token));
                        return;
                    }
                    // Anything else — /favicon.ico, a stray probe — is answered
                    // and ignored, and the wait continues.
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    let _ = tx.send(Err(HandoffError::TimedOut));
                    return;
                }
            }
        }
    });

    Ok((Handoff { port, state }, rx))
}

/// Reads one request line, answers it, and yields a token if it was the one.
fn handle(mut stream: TcpStream, expected_state: &str) -> Option<String> {
    let mut line = String::new();
    let readable = stream.try_clone().ok()?;
    if BufReader::new(readable).read_line(&mut line).is_err() {
        return None;
    }
    match parse_callback(line.trim_end(), expected_state) {
        Ok(token) => {
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                DONE_PAGE.len(),
                DONE_PAGE
            );
            Some(token)
        }
        Err(_) => {
            let _ = write!(
                stream,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_callback, HandoffError};

    #[test]
    fn extracts_the_token_when_the_state_matches() {
        let line = "GET /callback?token=abc123&state=nonce HTTP/1.1";
        assert_eq!(parse_callback(line, "nonce").unwrap(), "abc123");
    }

    #[test]
    fn order_of_the_query_parameters_does_not_matter() {
        let line = "GET /callback?state=nonce&token=abc123 HTTP/1.1";
        assert_eq!(parse_callback(line, "nonce").unwrap(), "abc123");
    }

    #[test]
    fn percent_encoded_values_are_decoded() {
        let line = "GET /callback?token=a+b%26c&state=nonce HTTP/1.1";
        assert_eq!(parse_callback(line, "nonce").unwrap(), "a b&c");
    }

    #[test]
    fn a_wrong_state_is_refused_even_with_a_valid_token() {
        let line = "GET /callback?token=abc123&state=attacker HTTP/1.1";
        assert!(matches!(
            parse_callback(line, "nonce"),
            Err(HandoffError::StateMismatch)
        ));
    }

    #[test]
    fn a_missing_state_is_refused() {
        let line = "GET /callback?token=abc123 HTTP/1.1";
        assert!(matches!(
            parse_callback(line, "nonce"),
            Err(HandoffError::StateMismatch)
        ));
    }

    #[test]
    fn an_empty_token_is_refused() {
        let line = "GET /callback?token=&state=nonce HTTP/1.1";
        assert!(parse_callback(line, "nonce").is_err());
    }

    #[test]
    fn incidental_requests_are_not_mistaken_for_the_callback() {
        // Browsers ask for this unprompted; it must not end the wait.
        assert!(parse_callback("GET /favicon.ico HTTP/1.1", "nonce").is_err());
        assert!(parse_callback("GET / HTTP/1.1", "nonce").is_err());
    }
}
