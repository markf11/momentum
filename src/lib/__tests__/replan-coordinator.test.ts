import { ReplanCoordinator } from "../replan-coordinator";

describe("ReplanCoordinator", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("debounces changes into one run", async () => {
    const runner = jest.fn().mockResolvedValue(undefined);
    const coordinator = new ReplanCoordinator(runner, 2_000);

    coordinator.request("user-1");
    coordinator.request("user-1");
    await jest.advanceTimersByTimeAsync(1_999);
    expect(runner).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("user-1");
  });

  it("runs again when a change arrives mid-run", async () => {
    let finishFirstRun: (() => void) | undefined;
    const runner = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstRun = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const coordinator = new ReplanCoordinator(runner, 2_000);
    const waiting = coordinator.wait("user-1");

    await jest.advanceTimersByTimeAsync(2_000);
    expect(runner).toHaveBeenCalledTimes(1);
    coordinator.request("user-1");
    finishFirstRun?.();
    await Promise.resolve();
    await Promise.resolve();
    await waiting;

    expect(runner).toHaveBeenCalledTimes(2);
  });
});
