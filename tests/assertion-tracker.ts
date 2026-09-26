export interface AssertionTracker {
  readonly active: number;
  run(
    number: number,
    message: string,
    operation: () => Promise<void> | void,
    detail?: string
  ): Promise<void>;
}

export function createAssertionTracker(write: (message: string) => void): AssertionTracker {
  let active = 0;
  return {
    get active(): number {
      return active;
    },
    async run(number, message, operation, detail = ""): Promise<void> {
      active = number;
      await operation();
      if (active !== number) {
        throw new Error(`assertion sequencing error: active=${active} pass=${number}`);
      }
      write(`ASSERT ${number} PASS ${message}${detail ? ` ${detail}` : ""}`);
      active = 0;
    }
  };
}
