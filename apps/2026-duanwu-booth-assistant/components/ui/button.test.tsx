import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("provides a shadcn-style default button", () => {
    render(<Button>继续了解</Button>);

    const button = screen.getByRole("button", { name: "继续了解" });

    expect(button).toHaveClass("inline-flex");
    expect(button).toHaveClass("bg-primary");
    expect(button).toHaveClass("rounded-md");
  });
});
