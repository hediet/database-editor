import type { AsyncLzmaCompressorApi } from "./asyncLzmaCompressor";
import { LzmaCompressor } from "./lzmaCompressor";
import { createChannelFactoryToParent, SimpleTypedRpcConnection } from "./rpc";

const compressor = new LzmaCompressor();

SimpleTypedRpcConnection.createClient<AsyncLzmaCompressorApi>(createChannelFactoryToParent(), {
    notifications: {},
    requests: {
        async decodeData(data) {
            return compressor.decodeData(data);
        },
        async encodeData(data) {
            return compressor.encodeData(data);
        },
    },
});
