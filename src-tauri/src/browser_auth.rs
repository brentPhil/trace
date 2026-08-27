use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// What the shell needs in order to send the browser somewhere useful.
pub struct Handoff {
    pub port: u16,
    pub state: String,
}

/// The receiving end of the callback, and the listener's leash.
///
/// A plain `Receiver` would do for delivery, but the listener thread needs to
/// know when the caller has given up: a sign-in the user cancelled otherwise
/// leaves a bound port and a live thread until the full timeout expires, and
/// repeated retries stack them up. `std::sync::mpsc::Sender` has no way to ask
/// whether its receiver is still there, so the answer is carried alongside:
/// this struct owns the only strong reference to `_leash`, the thread holds
/// the `Weak` side, and dropping this drops the count to zero.
///
/// Derefs to the `Receiver`, so `recv`, `recv_timeout` and `try_recv` are used
/// exactly as they would be on the bare channel.
pub struct Callback {
    rx: Receiver<Result<String, HandoffError>>,
    _leash: Arc<()>,
}

impl std::ops::Deref for Callback {
    type Target = Receiver<Result<String, HandoffError>>;

    fn deref(&self) -> &Self::Target {
        &self.rx
    }
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
    ///
    /// Holds `getrandom::Error` rather than a pre-rendered `String` so that
    /// `source()` keeps the chain intact: a caller walking the error chain, or
    /// a report that prints causes, still reaches the OS-level reason instead
    /// of a dead end at a message this module already flattened.
    Entropy(getrandom::Error),
}

impl std::fmt::Display for BeginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BeginError::Bind(err) => write!(f, "failed to bind the loopback listener: {err}"),
            BeginError::Entropy(err) => write!(f, "no system entropy for a sign-in nonce: {err}"),
        }
    }
}

impl std::error::Error for BeginError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            BeginError::Bind(err) => Some(err),
            BeginError::Entropy(err) => Some(err),
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

/// How long a peer that has connected gets to produce its request line.
///
/// Generous for a real browser on loopback — it has the whole request composed
/// before it opens the socket — and short enough that a process which connects
/// and then says nothing cannot sit on the listener thread indefinitely.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// The most of a request line this listener will buffer, in bytes.
///
/// A real callback is a URL with two short parameters; anything approaching
/// this is not our browser. See `handle` for why the cap has to be enforced by
/// the reader rather than checked afterwards.
const MAX_REQUEST_LINE: u64 = 8192;

/// Pulls the token out of a callback request line, refusing anything whose
/// `state` is not ours.
///
/// Pure and separately tested because this is the security boundary: it is the
/// only thing between a local process that guessed the port and a live
/// session. Everything it can get wrong — parameter order, percent encoding, a
/// missing nonce, the browser's unprompted /favicon.ico — is reachable from a
/// unit test without binding a socket.
pub fn parse_callback(request_line: &str, expected_state: &str) -> Result<String, HandoffError> {
    // An empty expectation would compare equal to a request carrying a blank
    // `state=`, and hand back its token. `begin` cannot produce one — a nonce
    // is always 64 hex characters or `mint_state` fails the whole flow — but
    // this function is `pub`, so it sits on the crate's external surface where
    // that guarantee no longer travels with it. Refuse here instead of relying
    // on every future caller to have read `mint_state`.
    if expected_state.is_empty() {
        return Err(HandoffError::StateMismatch);
    }

    let mut tokens = request_line.split_whitespace();
    // Pin the method. The callback is a top-level browser navigation, so it is
    // always a GET; matching on the second whitespace-separated token alone
    // would just as happily accept `POST /callback?…` or any other two-word
    // line that happens to have our path in the middle. Not a hole on its own
    // — the nonce still gates the token — but narrowing the accepted shape to
    // the one thing that can legitimately arrive costs nothing.
    if tokens.next() != Some("GET") {
        return Err(HandoffError::StateMismatch);
    }
    let path = tokens.next().ok_or(HandoffError::StateMismatch)?;
    let query = path
        .strip_prefix("/callback?")
        .ok_or(HandoffError::StateMismatch)?;

    let mut token = None;
    let mut state = None;
    // A repeated key is last-wins here. Deliberate and harmless: the state
    // check below runs over whichever value survives, so a duplicated `state`
    // can only make the request fail, never sneak a token past the nonce.
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
    //
    // Plain `==` rather than a constant-time compare — and NOT because an
    // attacker gets only one attempt. They get as many as they like: a
    // mismatch answers 404 and the accept loop goes straight back round, so
    // guesses are unlimited until the deadline. It is sound for two other
    // reasons. The secret is 256 CSPRNG bits, so the whole timeout's worth of
    // guesses is nowhere near a dent in the space. And the signal a byte-wise
    // compare leaks — a few nanoseconds of early exit — is buried beneath a
    // TCP accept and this listener's 50ms poll, orders of magnitude of noise
    // above anything a local peer could resolve into a per-byte answer.
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
    getrandom::fill(&mut bytes).map_err(BeginError::Entropy)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Binds a loopback port and waits, on its own thread, for one callback.
///
/// Returns as soon as the port is known so the caller can put it in the URL it
/// opens; the token arrives later on the returned `Callback`. Dropping that
/// `Callback` is how a caller cancels: the listener notices and lets the port
/// go rather than sitting out the rest of the timeout.
///
/// `127.0.0.1` explicitly rather than `localhost` — RFC 8252 §8.3 warns the
/// name can resolve to a non-loopback interface, which would put a session
/// token on the network.
pub fn begin(timeout: Duration) -> Result<(Handoff, Callback), BeginError> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;
    let state = mint_state()?;
    let (tx, rx) = channel();

    let leash = Arc::new(());
    let watch = Arc::downgrade(&leash);
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
                    // Nobody is holding the other end any more: the sign-in was
                    // cancelled, or the caller gave up and started a fresh one.
                    // Leave now instead of squatting on the port and this
                    // thread for the remainder of the timeout — a user who
                    // retries a few times would otherwise accumulate one of
                    // each per attempt. Checked here rather than at the top of
                    // the loop because this is the branch that idles; the other
                    // branches are all about to return anyway.
                    if watch.strong_count() == 0 {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                // Routine, transient, and none of them mean the listener is
                // finished: a port scanner that hangs up between the SYN and
                // our accept, or a browser abandoning a speculative socket,
                // produces ConnectionAborted/ConnectionReset, and a signal
                // produces Interrupted. Treating those as fatal killed an
                // in-progress sign-in AND told the user it had "timed out",
                // which was not what happened. Go round again; the next accept
                // returns WouldBlock and the branch above does the sleeping.
                Err(ref e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::Interrupted
                            | std::io::ErrorKind::ConnectionAborted
                            | std::io::ErrorKind::ConnectionReset
                    ) => {}
                // Anything else is the listener itself being broken (the socket
                // closed under us, fd exhaustion): no amount of retrying helps.
                Err(_) => {
                    let _ = tx.send(Err(HandoffError::TimedOut));
                    return;
                }
            }
        }
    });

    Ok((Handoff { port, state }, Callback { rx, _leash: leash }))
}

/// Reads one request line, answers it, and yields a token if it was the one.
fn handle(mut stream: TcpStream, expected_state: &str) -> Option<String> {
    // The LISTENER is non-blocking so the accept loop can honour its deadline.
    // Whether the accepted socket inherits that is platform-specific, and both
    // answers are broken here, so neither is assumed:
    //
    //   - Windows (and macOS) hand back an inheriting socket. If the request's
    //     first byte has not landed by the time `accept` returns, `read_line`
    //     fails with WouldBlock, this returns None, and the REAL callback is
    //     silently thrown away — the user watches a live browser tab while the
    //     app reports a timeout. Rare in the common case and deterministic for
    //     any peer that delays its first byte, such as endpoint-protection
    //     software interposing on loopback.
    //   - Linux does not inherit, so the stream arrives blocking with no read
    //     timeout at all. One local process that connects and sends nothing
    //     parks `read_line` forever: the deadline is never re-checked, nothing
    //     is ever sent on the channel, and the port and thread are held for
    //     good.
    //
    // So: force blocking, and bound the wait explicitly.
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(READ_TIMEOUT)).ok()?;

    let mut line = String::new();
    let readable = stream.try_clone().ok()?;
    // `read_line` appends until a newline or EOF with no ceiling of its own, so
    // a peer that streams bytes and never sends a newline grows this buffer
    // until the process runs out of memory. The cap has to be on the reader —
    // checking the length afterwards is too late, the allocation has already
    // happened.
    if BufReader::new(readable.take(MAX_REQUEST_LINE))
        .read_line(&mut line)
        .is_err()
    {
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
    use super::{begin, parse_callback, HandoffError};
    use std::io::Write;
    use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
    use std::time::Duration;

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
    fn an_empty_expected_state_never_matches() {
        // `begin` cannot mint one, but `parse_callback` is public: a caller
        // that passed an empty expectation would otherwise have every blank
        // `state=` compare equal and walk off with the token.
        let line = "GET /callback?token=abc123&state= HTTP/1.1";
        assert!(matches!(
            parse_callback(line, ""),
            Err(HandoffError::StateMismatch)
        ));
        let no_state = "GET /callback?token=abc123 HTTP/1.1";
        assert!(matches!(
            parse_callback(no_state, ""),
            Err(HandoffError::StateMismatch)
        ));
    }

    #[test]
    fn only_get_is_accepted() {
        // Any line whose second whitespace-separated token was our path used to
        // be enough on its own.
        for line in [
            "POST /callback?token=abc123&state=nonce HTTP/1.1",
            "HEAD /callback?token=abc123&state=nonce HTTP/1.1",
            "get /callback?token=abc123&state=nonce HTTP/1.1",
            "\u{0} /callback?token=abc123&state=nonce",
        ] {
            assert!(
                matches!(
                    parse_callback(line, "nonce"),
                    Err(HandoffError::StateMismatch)
                ),
                "accepted a non-GET request line: {line}"
            );
        }
    }

    #[test]
    fn an_empty_request_line_is_refused() {
        assert!(matches!(
            parse_callback("", "nonce"),
            Err(HandoffError::StateMismatch)
        ));
        assert!(matches!(
            parse_callback("GET", "nonce"),
            Err(HandoffError::StateMismatch)
        ));
    }

    #[test]
    fn a_repeated_parameter_takes_the_last_value() {
        // Documented rather than defended: the state check runs over whatever
        // survives, so a duplicate can only cause a refusal.
        let line = "GET /callback?token=first&token=second&state=nonce HTTP/1.1";
        assert_eq!(parse_callback(line, "nonce").unwrap(), "second");
        let shadowed = "GET /callback?state=nonce&state=attacker&token=abc HTTP/1.1";
        assert!(parse_callback(shadowed, "nonce").is_err());
    }

    #[test]
    fn incidental_requests_are_not_mistaken_for_the_callback() {
        // Browsers ask for this unprompted; it must not end the wait.
        assert!(parse_callback("GET /favicon.ico HTTP/1.1", "nonce").is_err());
        assert!(parse_callback("GET / HTTP/1.1", "nonce").is_err());
    }

    /// Connects to the listener, waits, and only then sends the request line.
    ///
    /// This is the case that used to lose real callbacks on Windows and macOS:
    /// the accepted socket inherited the listener's non-blocking mode, so the
    /// first `read_line` returned WouldBlock and the token went in the bin.
    #[test]
    fn a_callback_whose_first_byte_is_late_is_still_accepted() {
        let (handoff, rx) = begin(Duration::from_secs(20)).unwrap();
        let mut peer =
            TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, handoff.port))).unwrap();
        // Long enough that the accept has certainly already returned.
        std::thread::sleep(Duration::from_millis(400));
        write!(
            peer,
            "GET /callback?token=late-but-real&state={} HTTP/1.1\r\n\r\n",
            handoff.state
        )
        .unwrap();
        peer.flush().unwrap();

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(15)).unwrap().unwrap(),
            "late-but-real"
        );
    }

    /// A peer that connects and then says nothing must not own the listener.
    ///
    /// On Linux the accepted socket is blocking and had no read timeout, so
    /// this parked `read_line` forever: the deadline was never reached again
    /// and nothing was ever sent on the channel. The assertion is simply that
    /// an answer arrives at all.
    #[test]
    fn a_silent_peer_does_not_stall_the_listener() {
        let (handoff, rx) = begin(Duration::from_secs(1)).unwrap();
        let _mute =
            TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, handoff.port))).unwrap();

        // The read timeout (5s) outlasts the sign-in deadline (1s), so the
        // expected outcome is a timeout reported once the read gives up.
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(30)).unwrap(),
            Err(HandoffError::TimedOut)
        );
    }

    /// Dropping the `Callback` is a cancellation, and must free the port.
    ///
    /// Before, the thread ran out the whole deadline regardless, so a user who
    /// cancelled and retried accumulated a bound port and a live thread per
    /// attempt.
    #[test]
    fn cancelling_releases_the_port_without_waiting_out_the_deadline() {
        let (handoff, rx) = begin(Duration::from_secs(120)).unwrap();
        let port = handoff.port;
        drop(rx);

        // The thread notices on its next poll, which is at most 50ms away; the
        // retries cover a loaded machine without making the test depend on
        // exact timing. If it did wait out the deadline, no amount of retrying
        // inside this window would get the port back.
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let mut rebound = false;
        for _ in 0..40 {
            if TcpListener::bind(addr).is_ok() {
                rebound = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(rebound, "the cancelled listener kept port {port} bound");
    }
}
