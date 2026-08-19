import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
// NO `user-event` import — see the Global Constraint on test interactions.
import { afterEach, describe, expect, it, vi } from "vitest"
import { MusicControls } from "./music-controls"
import type { MusicContextValue } from "./music-provider"

afterEach(cleanup)

function value(overrides: Partial<MusicContextValue> = {}): MusicContextValue {
  return {
    tracks: [
      {
        ref: { origin: "chroneli", slug: "a" },
        name: "Lo-fi Chill",
        url: "/music/a.mp3",
        origin: "chroneli",
      },
      {
        ref: { origin: "upload", trackId: "t1" },
        name: "My Recording",
        url: "https://f/x",
        origin: "upload",
      },
    ],
    current: null,
    playing: false,
    blocked: false,
    volume: 0.6,
    shuffle: false,
    repeat: "all",
    // Returns `true` — `playRef` now reports whether the ref resolved, and a
    // stub that returned `undefined` would type-check as a permanent miss and
    // quietly describe a player that never finds anything.
    playRef: vi.fn(() => true),
    toggle: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    setVolume: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeat: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    onUserPick: vi.fn(() => () => {}),
    ...overrides,
  }
}

describe("collapsed", () => {
  it("shows only two controls when nothing is playing", () => {
    render(<MusicControls value={value()} />)
    expect(screen.getByRole("button", { name: /play music/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /music library/i })).toBeTruthy()
    // The panel's controls are not in the document until it is opened.
    expect(screen.queryByRole("button", { name: /next track/i })).toBe(null)
  })

  it("names the playing track for a screen reader without drawing a label", () => {
    render(
      <MusicControls
        value={value({
          playing: true,
          current: {
            ref: { origin: "chroneli", slug: "a" },
            name: "Lo-fi Chill",
            url: "/music/a.mp3",
            origin: "chroneli",
          },
        })}
      />
    )
    expect(screen.getByRole("button", { name: /pause music/i })).toBeTruthy()
    expect(screen.getByText("Lo-fi Chill")).toBeTruthy()
  })

  it("toggles playback", () => {
    const v = value()
    render(<MusicControls value={v} />)
    fireEvent.click(screen.getByRole("button", { name: /play music/i }))
    expect(v.toggle).toHaveBeenCalledTimes(1)
  })

  it("says so when the browser refused to start playback", () => {
    render(<MusicControls value={value({ blocked: true })} />)
    expect(screen.getByRole("button", { name: /click to play/i })).toBeTruthy()
  })
})

describe("the panel", () => {
  async function open() {
    const v = value()
    render(<MusicControls value={v} />)
    fireEvent.click(screen.getByRole("button", { name: /music library/i }))
    // Base UI's popup mounts into a portal asynchronously; `findByRole` waits
    // for it rather than assuming it is already in the document the instant
    // the click handler returns.
    await screen.findByRole("group", { name: /chroneli music/i })
    return v
  }

  it("exposes transport, shuffle, repeat and volume", async () => {
    await open()
    expect(screen.getByRole("button", { name: /previous track/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /next track/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /shuffle/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /repeat/i })).toBeTruthy()
    expect(screen.getByRole("slider", { name: /volume/i })).toBeTruthy()
  })

  it("lists catalog and uploaded tracks under separate headings", async () => {
    await open()
    const chroneli = screen.getByRole("group", { name: /chroneli music/i })
    expect(within(chroneli).getByText("Lo-fi Chill")).toBeTruthy()
    const mine = screen.getByRole("group", { name: /my music/i })
    expect(within(mine).getByText("My Recording")).toBeTruthy()
  })

  it("plays the track that is clicked", async () => {
    const v = await open()
    fireEvent.click(screen.getByRole("button", { name: /play lo-fi chill/i }))
    expect(v.playRef).toHaveBeenCalledWith({ origin: "chroneli", slug: "a" })
  })

  it("dispatches next and previous", async () => {
    const v = await open()
    fireEvent.click(screen.getByRole("button", { name: /next track/i }))
    fireEvent.click(screen.getByRole("button", { name: /previous track/i }))
    expect(v.next).toHaveBeenCalledTimes(1)
    expect(v.previous).toHaveBeenCalledTimes(1)
  })
})

describe("track identity", () => {
  /*
   * A name is user-supplied and renameable, so two uploads may legitimately
   * carry the same one. Keying rows or the playing-highlight on the NAME makes
   * those two rows indistinguishable: React reconciles them as one, and the
   * wrong row lights up. The ref is the identity, and `trackRefEquals` is what
   * compares it — this test is here because the first version of this file
   * keyed on the name and passed every other test in the suite.
   */
  const twins = [
    {
      ref: { origin: "upload" as const, trackId: "t1" },
      name: "Untitled",
      url: "https://f/1",
      origin: "upload" as const,
    },
    {
      ref: { origin: "upload" as const, trackId: "t2" },
      name: "Untitled",
      url: "https://f/2",
      origin: "upload" as const,
    },
  ]

  it("renders both of two identically named uploads", async () => {
    const v = value({ tracks: twins })
    render(<MusicControls value={v} />)
    fireEvent.click(screen.getByRole("button", { name: /music library/i }))
    const mine = await screen.findByRole("group", { name: /my music/i })
    expect(
      within(mine).getAllByRole("button", { name: /play untitled/i })
    ).toHaveLength(2)
  })

  it("marks only the playing one as current", async () => {
    const v = value({ tracks: twins, current: twins[1] })
    render(<MusicControls value={v} />)
    fireEvent.click(screen.getByRole("button", { name: /music library/i }))
    const mine = await screen.findByRole("group", { name: /my music/i })
    const rows = within(mine).getAllByRole("button", { name: /play untitled/i })
    expect(rows[0].getAttribute("aria-current")).toBe(null)
    expect(rows[1].getAttribute("aria-current")).toBe("true")
  })
})

describe("the spinning disc", () => {
  /*
   * The disc turns while something plays. It is the THIRD carrier of that
   * state — after the speaker icon's shape and the Now Playing name — which is
   * why `motion-reduce` may drop it outright without the state becoming
   * unreadable. These assert the class, since jsdom runs no animations.
   */
  const nowPlaying = {
    ref: { origin: "chroneli" as const, slug: "a" },
    name: "Lo-fi Chill",
    url: "/music/a.mp3",
    origin: "chroneli" as const,
  }

  const disc = () =>
    screen.getByRole("button", { name: /music library/i }).querySelector("svg")

  it("does not spin when nothing is playing", () => {
    render(<MusicControls value={value()} />)
    expect(disc()?.getAttribute("class")).not.toContain("animate-spin")
  })

  it("spins while playing, and stands still for reduced motion", () => {
    render(
      <MusicControls value={value({ playing: true, current: nowPlaying })} />
    )
    const cls = disc()?.getAttribute("class") ?? ""
    expect(cls).toContain("animate-spin")
    expect(cls).toContain("motion-reduce:animate-none")
  })
})

describe("which row is playing", () => {
  const chill = {
    ref: { origin: "chroneli" as const, slug: "a" },
    name: "Lo-fi Chill",
    url: "/music/a.mp3",
    origin: "chroneli" as const,
  }

  async function openPanel(v: MusicContextValue) {
    render(<MusicControls value={v} />)
    fireEvent.click(screen.getByRole("button", { name: /music library/i }))
    return await screen.findByRole("group", { name: /chroneli music/i })
  }

  const rowFor = (group: HTMLElement, name: RegExp) =>
    within(group).getByRole("button", { name })

  it("marks only the current row with a disc", async () => {
    const group = await openPanel(value({ playing: true, current: chill }))
    expect(rowFor(group, /play lo-fi chill/i).querySelector("svg")).toBeTruthy()
  })

  it("draws no disc on any row when nothing is current", async () => {
    const group = await openPanel(value())
    expect(rowFor(group, /play lo-fi chill/i).querySelector("svg")).toBe(null)
  })

  it("spins the current row's disc only while playback is running", async () => {
    const spinning = await openPanel(value({ playing: true, current: chill }))
    expect(
      rowFor(spinning, /play lo-fi chill/i)
        .querySelector("svg")
        ?.getAttribute("class")
    ).toContain("animate-spin")

    cleanup()

    const paused = await openPanel(value({ playing: false, current: chill }))
    const cls =
      rowFor(paused, /play lo-fi chill/i)
        .querySelector("svg")
        ?.getAttribute("class") ?? ""
    expect(cls).not.toContain("animate-spin")
  })

  /*
   * A dead track can be `current` for a beat, because `start` sets the ref
   * before it discovers there is no URL. A spinning disc there would claim
   * playback that cannot happen.
   */
  it("says unavailable rather than drawing a disc on a dead current track", async () => {
    const dead = { ...chill, url: null }
    const group = await openPanel(
      value({ tracks: [dead], playing: true, current: dead })
    )
    const row = rowFor(group, /play lo-fi chill/i)
    expect(within(row).getByText("unavailable")).toBeTruthy()
    expect(row.querySelector("svg")).toBe(null)
  })
})
