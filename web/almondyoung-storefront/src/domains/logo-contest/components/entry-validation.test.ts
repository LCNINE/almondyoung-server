import { describe, expect, it } from "vitest"
import { validateEntry } from "./entry-validation"

const messages = {
  nameRequired: "name",
  nameTooLong: "long name",
  descriptionTooLong: "long description",
  wordmarkRequired: "wordmark",
  iconRequired: "icon",
  agreeRequired: "agreement",
}

describe("contest entry validation", () => {
  it("reports each missing required field and accepts a complete entry", () => {
    expect(
      validateEntry(
        {
          title: "  ",
          description: "",
          hasWordmark: false,
          hasIcon: false,
          agreed: false,
        },
        messages
      )
    ).toEqual({
      title: "name",
      wordmark: "wordmark",
      icon: "icon",
      agreed: "agreement",
    })
    expect(
      validateEntry(
        {
          title: "Logo",
          description: "",
          hasWordmark: true,
          hasIcon: true,
          agreed: true,
        },
        messages
      )
    ).toEqual({})
  })
})
