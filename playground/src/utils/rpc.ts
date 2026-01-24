
export type ChannelFactory = (handler: IChannelHandler) => IChannel;

export interface IChannel {
    sendNotification(data: unknown[] | Record<string, unknown>): void;
    sendRequest(data: unknown[] | Record<string, unknown>): Promise<RpcRequestResult>;
}

export interface IChannelHandler {
    handleNotification(notificationData: unknown): void;
    handleRequest(requestData: unknown): Promise<RpcRequestResult> | RpcRequestResult;
}

export type RpcRequestResult = { type: 'result', value: unknown } | { type: 'error', value: unknown };

export type API = {
    host: Side;
    client: Side;
}

export type CreateApi<T extends API> = T;

export type Side = {
    notifications: Record<string, (...args: any[]) => void>;
    requests: Record<string, (...args: any[]) => Promise<unknown> | unknown>;
}

type MakeAsyncIfNot<TFn> = TFn extends (...args: infer TArgs) => infer TResult ? TResult extends Promise<unknown> ? TFn : (...args: TArgs) => Promise<TResult> : never

export type MakeSideAsync<T extends Side> = {
    notifications: T['notifications'];
    requests: { [K in keyof T['requests']]: MakeAsyncIfNot<T['requests'][K]> }
};

export class SimpleTypedRpcConnection<T extends Side> {
    public static createHost<T extends API>(channelFactory: ChannelFactory, handler: T['host']): SimpleTypedRpcConnection<MakeSideAsync<T['client']>> {
        return new SimpleTypedRpcConnection(channelFactory, handler);
    }

    public static createClient<T extends API>(channelFactory: ChannelFactory, handler: T['client']): SimpleTypedRpcConnection<MakeSideAsync<T['host']>> {
        return new SimpleTypedRpcConnection(channelFactory, handler);
    }

    public readonly api: T;
    private readonly _channel: IChannel;

    private constructor(
        private readonly _channelFactory: ChannelFactory,
        private readonly _handler: Side,
    ) {
        this._channel = this._channelFactory({
            handleNotification: (notificationData) => {
                const m = notificationData as OutgoingMessage;
                this._handler.notifications[m[0]](...m[1]);
            },
            handleRequest: async (requestData) => {
                const m = requestData as OutgoingMessage;
                try {
                    const result = await this._handler.requests[m[0]](...m[1]);
                    return { type: 'result', value: result };
                } catch (e) {
                    return { type: 'error', value: e };
                }
            },
        });

        const requests = new Proxy({}, {
            get: (_target, key: string) => {
                return async (...args: any[]) => {
                    const result = await this._channel.sendRequest([key, args] satisfies OutgoingMessage);
                    if (result.type === 'error') {
                        throw result.value;
                    } else {
                        return result.value;
                    }
                }
            }
        });

        const notifications = new Proxy({}, {
            get: (_target, key: string) => {
                return (...args: any[]) => {
                    this._channel.sendNotification([key, args] satisfies OutgoingMessage);
                }
            }
        });

        this.api = { notifications: notifications, requests: requests } as any;
    }
}

type OutgoingMessage = [
    method: string,
    args: unknown[],
];

export function createChannelFactoryFromWorker(worker: Worker): ChannelFactory {
    return createChannelFactory(createConnectionToWebTarget(worker));
}

export function createChannelFactoryToParent(): ChannelFactory {
    return createChannelFactory(createConnectionToWebTarget(self));
}

interface IWebTarget {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

function createConnectionToWebTarget(webTarget: IWebTarget): IConnection {
    let h: ((e: MessageEvent) => void) | null = null;
    return {
        sendMessage: (message) => {
            webTarget.postMessage(message);
        },
        setMessageHandler: (handler) => {
            if (h) {
                webTarget.removeEventListener('message', h);
            }
            h = (e) => {
                handler(e.data);
            };
            webTarget.addEventListener('message', h);
        },
    };
}

interface IRequestMessage {
    type: 'request';
    requestId: number;
    data: unknown[] | Record<string, unknown>;
}

interface IResponseMessage {
    type: 'result' | 'error';
    requestId: number;
    result: unknown;
}

interface INotificationMessage {
    type: 'notification';
    data: unknown[] | Record<string, unknown>;
}

type Message = IRequestMessage | IResponseMessage | INotificationMessage;

interface IConnection {
    sendMessage(message: Message): void;
    setMessageHandler(handler: (message: Message) => void): void;
}

function createChannelFactory(connection: IConnection): ChannelFactory {
    return (handler) => {
        const pendingRequests = new Map<number, (response: RpcRequestResult) => void>();
        let idCounter = 0;

        const channel: IChannel = {
            sendNotification: (data) => {
                connection.sendMessage({ type: 'notification', data });
            },
            sendRequest: async (data) => {
                const curId = idCounter++;
                return new Promise(res => {
                    pendingRequests.set(curId, res);
                    connection.sendMessage({ type: 'request', requestId: curId, data });
                });
            },
        };

        connection.setMessageHandler(async (message) => {
            if (message.type === 'notification') {
                handler.handleNotification(message.data);
            } else if (message.type === 'request') {
                const response = await handler.handleRequest(message.data);
                connection.sendMessage({
                    type: response.type,
                    requestId: message.requestId,
                    result: response.value,
                });
            } else if (message.type === 'result' || message.type === 'error') {
                const pendingRequest = pendingRequests.get(message.requestId);
                if (pendingRequest) {
                    pendingRequests.delete(message.requestId);
                    pendingRequest({ type: message.type, value: message.result });
                }
            }
        });

        return channel;
    };
}
