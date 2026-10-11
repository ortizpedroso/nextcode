> ## Documentation Index
> Fetch the complete documentation index at: https://docs.typesafe.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Usage

> Guides and patterns for working with the TypeSafe Python SDK.

<a id="usage" />

<h2 id="calling-the-system-one-api">
  Calling the System One API
</h2>

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, Score


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            result = await client.system_one(
                "I was charged twice. Please help ASAP.",
                {
                    "billing": Noul(instructions="Is this about billing?"),
                    "tone": Choice(
                        instructions="What is the tone?",
                        criteria={"calm": None, "angry": None},
                    ),
                    "urgency": Score(
                        instructions="How urgent is this?",
                        criteria=["low", "medium", "high"],
                    ),
                },
            )
            print(
                result.nouls["billing"].noul,
                result.choices["tone"].choice,
                result.scores["urgency"].score,
            )


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

    client = TypeSafeClient()
    state = "I was charged twice. Please help ASAP."
    questions = {
        "billing": Noul(instructions="Is this about billing?"),
        "tone": Choice(
            instructions="What is the tone?", criteria={"calm": None, "angry": None}
        ),
        "urgency": Score(
            instructions="How urgent is this?", criteria=["low", "medium", "high"]
        ),
    }
    result = client.system_one(state, questions)
    print(
        result.nouls["billing"].noul,
        result.choices["tone"].choice,
        result.scores["urgency"].score,
    )
    ```
  </Tab>
</Tabs>

<h2 id="typed-system_one-responses">
  Typed <code>system\_one</code> responses
</h2>

It is possible to provide a response model to `system_one` to make using the response more *type-safe*:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient, Noul, NoulAnswer, SystemOneResponse


    class BillingResponse(SystemOneResponse):
        billing: NoulAnswer


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            result = await client.system_one(
                "I was charged twice.",
                {"billing": Noul(instructions="Is this about billing?")},
                response_model=BillingResponse,
            )
            assert 0 <= result.billing.noul <= 1
            assert result.billing == result.nouls["billing"]
            print(result.request_id)


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import Noul, NoulAnswer, SystemOneResponse, TypeSafeClient


    class BillingResponse(SystemOneResponse):
        billing: NoulAnswer


    with TypeSafeClient() as client:
        result = client.system_one(
            "I was charged twice.",
            {"billing": Noul(instructions="Is this about billing?")},
            response_model=BillingResponse,
        )
        assert 0 <= result.billing.noul <= 1
        assert result.billing == result.nouls["billing"]
        print(result.request_id)
    ```
  </Tab>
</Tabs>

<h3 id="custom-response-types">
  Custom response types
</h3>

It is also possible to define a completely new response model without inheriting from `SystemOneResponse`:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from pydantic import BaseModel

    from typesafe_sdk import AsyncTypeSafeClient, Noul, NoulAnswer


    class BillingAnswers(BaseModel):
        billing: NoulAnswer


    class BillingResponse(BaseModel):
        answers: BillingAnswers


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            result = await client.system_one(
                "I was charged twice.",
                {"billing": Noul(instructions="Is this about billing?")},
                response_model=BillingResponse,
            )
            assert 0 <= result.answers.billing.noul <= 1


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from pydantic import BaseModel

    from typesafe_sdk import Noul, NoulAnswer, TypeSafeClient


    class BillingAnswers(BaseModel):
        billing: NoulAnswer


    class BillingResponse(BaseModel):
        answers: BillingAnswers


    result = TypeSafeClient().system_one(
        "I was charged twice.",
        {"billing": Noul(instructions="Is this about billing?")},
        response_model=BillingResponse,
    )
    assert 0 <= result.answers.billing.noul <= 1
    ```
  </Tab>
</Tabs>

<h2 id="choosing-a-model">
  Choosing a model
</h2>

Inspect the available models:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            print(await client.models.list())


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import TypeSafeClient

    print(TypeSafeClient().models.list())
    ```
  </Tab>
</Tabs>

Select the model when constructing a client:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    client = AsyncTypeSafeClient(model="jev")
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    client = TypeSafeClient(model="jev")
    ```
  </Tab>
</Tabs>

See the [Models resource reference](/sdk/python/api/clients/sync#models-resource) for details.

<h2 id="configuring-the-base-url">
  Configuring the base URL
</h2>

In order to use the SDK with a different API url, set `base_url` on the client or the `TYPESAFE_BASE_URL` environment variable. This requires the alternative API to follow the [TypeSafe OpenAPI spec](https://api.typesafe.ai/docs/).

For example, connect through an AI gateway using its API key and model ID.

<Tabs>
  <Tab title="OpenRouter">
    Use an OpenRouter API key and an [OpenRouter model ID](https://openrouter.ai/~typesafe/jev-latest/):

    <Tabs>
      <Tab title="Async client">
        ```python theme={null}
        import asyncio
        import os

        from typesafe_sdk import AsyncTypeSafeClient, Noul


        async def main() -> None:
            async with AsyncTypeSafeClient(
                api_key=os.environ["OPENROUTER_API_KEY"],
                base_url="https://openrouter.ai/api",
                model="~typesafe/jev-latest",
            ) as client:
                result = await client.system_one(
                    "I was charged twice.",
                    {"billing": Noul(instructions="Is this about billing?")},
                )
                print(result.nouls["billing"].noul)


        asyncio.run(main())
        ```
      </Tab>

      <Tab title="Sync client">
        ```python theme={null}
        import os

        from typesafe_sdk import Noul, TypeSafeClient

        with TypeSafeClient(
            api_key=os.environ["OPENROUTER_API_KEY"],
            base_url="https://openrouter.ai/api",
            model="~typesafe/jev-latest",
        ) as client:
            result = client.system_one(
                "I was charged twice.",
                {"billing": Noul(instructions="Is this about billing?")},
            )
            print(result.nouls["billing"].noul)
        ```
      </Tab>
    </Tabs>
  </Tab>

  <Tab title="Vercel AI Gateway">
    [Vercel's TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe) can be used with the SDK:

    <Tabs>
      <Tab title="Async client">
        ```python theme={null}
        import asyncio
        import os

        from typesafe_sdk import AsyncTypeSafeClient, Noul


        async def main() -> None:
            async with AsyncTypeSafeClient(
                api_key=os.environ["AI_GATEWAY_API_KEY"],
                base_url="https://ai-gateway.vercel.sh/typesafe",
                model="typesafe-ai/jev",
            ) as client:
                result = await client.system_one(
                    "I was charged twice.",
                    {"billing": Noul(instructions="Is this about billing?")},
                )
                print(result.nouls["billing"].noul)


        asyncio.run(main())
        ```
      </Tab>

      <Tab title="Sync client">
        ```python theme={null}
        import os

        from typesafe_sdk import Noul, TypeSafeClient

        with TypeSafeClient(
            api_key=os.environ["AI_GATEWAY_API_KEY"],
            base_url="https://ai-gateway.vercel.sh/typesafe",
            model="typesafe-ai/jev",
        ) as client:
            result = client.system_one(
                "I was charged twice.",
                {"billing": Noul(instructions="Is this about billing?")},
            )
            print(result.nouls["billing"].noul)
        ```
      </Tab>
    </Tabs>
  </Tab>

  <Tab title="Pydantic AI Gateway">
    Use a [Pydantic AI Gateway API key](https://pydantic.dev/articles/jev-pydantic-ai-gateway):

    <Tabs>
      <Tab title="Async client">
        ```python theme={null}
        import asyncio
        import os

        from typesafe_sdk import AsyncTypeSafeClient, Noul


        async def main() -> None:
            async with AsyncTypeSafeClient(
                api_key=os.environ["PYDANTIC_AI_GATEWAY_API_KEY"],
                base_url="https://gateway-us.pydantic.dev/proxy/typesafe",
                model="jev-latest",
            ) as client:
                result = await client.system_one(
                    "I was charged twice.",
                    {"billing": Noul(instructions="Is this about billing?")},
                )
                print(result.nouls["billing"].noul)


        asyncio.run(main())
        ```
      </Tab>

      <Tab title="Sync client">
        ```python theme={null}
        import os

        from typesafe_sdk import Noul, TypeSafeClient

        with TypeSafeClient(
            api_key=os.environ["PYDANTIC_AI_GATEWAY_API_KEY"],
            base_url="https://gateway-us.pydantic.dev/proxy/typesafe",
            model="jev-latest",
        ) as client:
            result = client.system_one(
                "I was charged twice.",
                {"billing": Noul(instructions="Is this about billing?")},
            )
            print(result.nouls["billing"].noul)
        ```
      </Tab>
    </Tabs>
  </Tab>
</Tabs>

<h2 id="performance">
  Performance
</h2>

If your application sends hundreds of requests per second, follow these recommendations.

<h3 id="reuse-clients">
  Reuse clients
</h3>

Make sure to reuse a client instance when sending multiple requests. Setting up a new client involves the overhead of starting new connections and TLS handshakes.

<h3 id="use-aiohttp-for-async-code">
  Use <code>aiohttp</code> for async code
</h3>

For async code at high request rates, pass an [aiohttp](https://docs.aiohttp.org/)-based HTTP client from [`httpx-aiohttp`](https://pypi.org/project/httpx-aiohttp/):

```shell theme={null}
uv add "httpx-aiohttp[httpx2]"
```

```python theme={null}
from httpx_aiohttp.httpx2 import Httpx2AiohttpClient

from typesafe_sdk import AsyncTypeSafeClient

client = AsyncTypeSafeClient(http_client=Httpx2AiohttpClient())
```

<h3 id="create-a-client-per-thread">
  Create a client per thread
</h3>

`TypeSafeClient` can be shared between threads, but under heavy load its connection pool becomes the bottleneck. Create one client per thread and reuse it for every request that thread sends.

```python theme={null}
import threading

from typesafe_sdk import TypeSafeClient


class ThreadClients(threading.local):
    def __init__(self) -> None:
        self.client = TypeSafeClient()


clients = ThreadClients()

# In any thread, `clients.client` is that thread's own client.
```

<h3 id="http2">
  HTTP/2
</h3>

The clients use HTTP/1.1 by default and can switch to HTTP/2:

* **HTTP/1.1** sends one request at a time per connection and opens a connection for each concurrent request, up to the [connection limit](/sdk/python/usage#keep-a-connection-limit). Concurrency scales with the number of connections, at the cost of a TLS handshake for each new one.
* **HTTP/2** multiplexes every request from one client over a single connection. It needs only one handshake and one socket, but that connection caps the client's throughput.

Keep the default HTTP/1.1 for high request rates. Use HTTP/2 for low to moderate concurrency when you want fewer connections, for example behind a proxy or firewall that limits them.

To enable HTTP/2, install the `'typesafe-sdk[http2]'` extra and pass an HTTP/2 client. See the [`httpx2` HTTP/2 guide](https://pydantic.dev/docs/httpx2/guides/http2/) for details.

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import httpx2

    from typesafe_sdk import AsyncTypeSafeClient

    client = AsyncTypeSafeClient(http_client=httpx2.AsyncClient(http2=True))
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    import httpx2

    from typesafe_sdk import TypeSafeClient

    client = TypeSafeClient(http_client=httpx2.Client(http2=True))
    ```
  </Tab>
</Tabs>

<h3 id="keep-a-connection-limit">
  Keep a connection limit
</h3>

The default clients open at most 100 connections and keep all of them open for 30 seconds while idle, so bursts reuse connections instead of opening new ones. Make sure to set appropriate limits when providing your own `http_client`.

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import httpx2

    from typesafe_sdk import AsyncTypeSafeClient

    limits = httpx2.Limits(
        max_connections=200, max_keepalive_connections=200, keepalive_expiry=30
    )
    client = AsyncTypeSafeClient(http_client=httpx2.AsyncClient(limits=limits))
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    import httpx2

    from typesafe_sdk import TypeSafeClient

    limits = httpx2.Limits(
        max_connections=200, max_keepalive_connections=200, keepalive_expiry=30
    )
    client = TypeSafeClient(http_client=httpx2.Client(limits=limits))
    ```
  </Tab>
</Tabs>

<h2 id="retries">
  Retries
</h2>

Pass a custom [`RetryPolicy`](/sdk/python/api/retries) as `retry` on the client or per call. Invalid API keys raise `TypeSafeError` during client creation, before any request or retry.

On the client:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    from typesafe_sdk import AsyncTypeSafeClient, RetryPolicy

    client = AsyncTypeSafeClient(
        retry=RetryPolicy(max_retries=3, backoff_max=0.2, timeout=1.0)
    )
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import RetryPolicy, TypeSafeClient

    client = TypeSafeClient(retry=RetryPolicy(max_retries=3, backoff_max=0.2, timeout=1.0))
    ```
  </Tab>
</Tabs>

Per call:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient, RetryPolicy


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            await client.system_one(
                state,
                questions,
                retry=RetryPolicy(max_retries=3, backoff_max=0.2, timeout=1.0),
            )


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import RetryPolicy

    client.system_one(
        state, questions, retry=RetryPolicy(max_retries=3, backoff_max=0.2, timeout=1.0)
    )
    ```
  </Tab>
</Tabs>

<h2 id="error-handling">
  Error handling
</h2>

Handle [exceptions](/sdk/python/api/exceptions) raised by the SDK:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient, TypeSafeAPIError


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            try:
                await client.system_one(state, questions)
            except TypeSafeAPIError as error:
                print(error.status, error.request_id)


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import TypeSafeAPIError

    try:
        client.system_one(state, questions)
    except TypeSafeAPIError as error:
        print(error.status, error.request_id)
    ```
  </Tab>
</Tabs>

<h2 id="logging">
  Logging
</h2>

The SDK logs to the `typesafe_sdk` logger. Configure it according to [standard logging](https://docs.python.org/3/library/logging.html) guide:

```python theme={null}
import logging

logging.getLogger("typesafe_sdk").setLevel(logging.DEBUG)
```

Or set `TYPESAFE_LOG_LEVEL` to one of `debug`, `info`, `warning`, `error`, or `off` before importing the SDK.

`info` logs one summary line per request; `debug` also logs request and response headers and bodies. Secret headers — authorization, API keys, cookies, and any header whose name contains `token` or `secret` — are redacted from log output. Request and response bodies are **not** redacted.

<h2 id="environment-variables">
  Environment variables
</h2>

The SDK reads and uses the following environment variables:

| Variable | Configures | Default |
| - | - | - |
| `TYPESAFE_API_KEY` | API key (required) | — |
| `TYPESAFE_BASE_URL` | API root URL | `https://api.typesafe.ai` |
| `TYPESAFE_DEFAULT_MODEL` | Default model | `jev-latest` |
| `TYPESAFE_LOG_LEVEL` | `typesafe_sdk` logger level, applied once at import | unset |

See the [constants reference](/sdk/python/api/constants) for SDK defaults.

API keys supplied through `api_key` or `TYPESAFE_API_KEY` have leading and trailing whitespace stripped, including newlines from key files. Empty keys, internal whitespace, control characters, and non-ASCII characters are rejected before sending a request. An explicitly empty key does not fall back to the environment.

<h2 id="forward-compatibility">
  Forward compatibility
</h2>

The SDK keeps working as the TypeSafe API evolves, so you can adopt new API features before an SDK release adds first-class support for them.

<h3 id="extra-request-fields">
  Extra request fields
</h3>

Send additional API request fields with [`extra_body`](/sdk/python/api/clients/sync). The `beam_width` field below is illustrative; only send fields supported by the API.

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient, Noul


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            await client.system_one(
                "I was charged twice.",
                {"billing": Noul(instructions="About billing?")},
                extra_body={"beam_width": 4},
            )


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import Noul, TypeSafeClient

    with TypeSafeClient() as client:
        client.system_one(
            "I was charged twice.",
            {"billing": Noul(instructions="About billing?")},
            extra_body={"beam_width": 4},
        )
    ```
  </Tab>
</Tabs>

<h3 id="raw-question-dictionaries">
  Raw question dictionaries
</h3>

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            await client.system_one(
                "I was charged twice.",
                {
                    "billing": {
                        "type": "noul",
                        "instructions": "About billing?",
                        "weight": 2,
                    }
                },
            )


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import TypeSafeClient

    with TypeSafeClient() as client:
        client.system_one(
            "I was charged twice.",
            {"billing": {"type": "noul", "instructions": "About billing?", "weight": 2}},
        )
    ```
  </Tab>
</Tabs>

<Tip>
  **Tip**

  Unknown fields are a forward-compatibility escape hatch. Ignore their type-checking errors and prefer upgrading the SDK instead.
</Tip>

<h3 id="unknown-answer-kinds">
  Unknown answer kinds
</h3>

The SDK logs a warning and skips unrecognized answer kinds. Use `raw_http_response` to inspect the complete API response, including those answers:

<Tabs>
  <Tab title="Async">
    ```python theme={null}
    import asyncio

    from typesafe_sdk import AsyncTypeSafeClient, Noul


    async def main() -> None:
        async with AsyncTypeSafeClient() as client:
            result = await client.system_one(
                "I was charged twice.",
                {"billing": Noul(instructions="Is this about billing?")},
            )
            print(result.raw_http_response.json()["answers"])


    asyncio.run(main())
    ```
  </Tab>

  <Tab title="Sync">
    ```python theme={null}
    from typesafe_sdk import Noul, TypeSafeClient

    result = TypeSafeClient().system_one(
        "I was charged twice.",
        {"billing": Noul(instructions="Is this about billing?")},
    )
    raw_answers = result.raw_http_response.json()["answers"]
    ```
  </Tab>
</Tabs>

<h3 id="unknown-response-fields">
  Unknown response fields
</h3>

Unknown extra fields on recognized responses are ignored.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.