import type { WebviewToHost } from "../../src/shared/protocol";

declare function acquireVsCodeApi(): {
    postMessage: (m: unknown) => void;
    getState: () => unknown;
    setState: (state: unknown) => void;
};

type VscodeApi = ReturnType<typeof acquireVsCodeApi>;
let _api: VscodeApi | undefined;

function api(): VscodeApi {
    if (!_api) _api = acquireVsCodeApi();
    return _api;
}

export function post(msg: WebviewToHost): void {
    api().postMessage(msg);
}

export function getState(): unknown {
    return api().getState();
}

export function setState(state: unknown): void {
    api().setState(state);
}
