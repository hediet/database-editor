import { CreateApi, createChannelFactoryFromWorker, SimpleTypedRpcConnection } from "./rpc";

export class AsyncLzmaCompressor<T> {
    private readonly _worker = new Worker(new URL('./lzmaWorker', import.meta.url), { type: 'module' });
    private readonly _rpc = SimpleTypedRpcConnection.createHost<AsyncLzmaCompressorApi>(createChannelFactoryFromWorker(this._worker), {
        notifications: {},
        requests: {},
    });

    constructor() { }

    encodeData(json: T): Promise<string> {
        return this._rpc.api.requests.encodeData(json);
    }

    decodeData(data: string): Promise<T> {
        return this._rpc.api.requests.decodeData(data);
    }
}

export type AsyncLzmaCompressorApi = CreateApi<{
    host: {
        notifications: {},
        requests: {},
    };
    client: {
        notifications: {},
        requests: {
            encodeData: (data: any) => Promise<string>;
            decodeData: (data: string) => Promise<any>;
        },
    };
}>;
