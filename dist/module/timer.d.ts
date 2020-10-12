export default class Timer {
    callback: Function;
    timerCalc: Function;
    timer: number | undefined;
    tries: number;
    constructor(callback: Function, timerCalc: Function);
    reset(): void;
    scheduleTimeout(): void;
}
//# sourceMappingURL=timer.d.ts.map