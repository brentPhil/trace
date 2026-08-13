import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { BulkEntryActions } from "./bulk-entry-actions"

afterEach(cleanup)

it("reports underlying records and exposes delete and clear", () => {
  const onDelete = vi.fn()
  const onClear = vi.fn()
  render(
    <BulkEntryActions
      count={3}
      deleting={false}
      onDelete={onDelete}
      onClear={onClear}
    />
  )
  expect(screen.getByText("3 records selected")).toBeTruthy()
  fireEvent.click(
    screen.getByRole("button", { name: "Delete selected records" })
  )
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
  expect(onDelete).toHaveBeenCalledTimes(1)
  expect(onClear).toHaveBeenCalledTimes(1)
})

it("counts one selected record in the singular", () => {
  render(
    <BulkEntryActions
      count={1}
      deleting={false}
      onDelete={() => {}}
      onClear={() => {}}
    />
  )
  expect(screen.getByText("1 record selected")).toBeTruthy()
})

it("disables only Delete while a delete is in flight", () => {
  render(
    <BulkEntryActions
      count={2}
      deleting
      onDelete={() => {}}
      onClear={() => {}}
    />
  )
  expect(
    screen
      .getByRole("button", { name: "Delete selected records" })
      .hasAttribute("disabled")
  ).toBe(true)
  // Clear stays live: a delete that hangs must not trap the reader in a
  // selection they can no longer dismiss.
  expect(
    screen
      .getByRole("button", { name: "Clear selection" })
      .hasAttribute("disabled")
  ).toBe(false)
})
