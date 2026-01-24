# Medusa JS SDK

In this documentation, you'll learn how to install and use Medusa's JS SDK.

## What is Medusa JS SDK?

Medusa's JS SDK is a library to easily send requests to your Medusa application. You can use it in your admin customizations or custom storefronts.

***

## How to Install Medusa JS SDK?

The Medusa JS SDK is available in your Medusa application by default. So, you don't need to install it before using it in your admin customizations.

To install the Medusa JS SDK in other projects, such as a custom storefront, run the following command:

```bash npm2yarn
npm install @medusajs/js-sdk@latest @medusajs/types@latest
```

You install two libraries:

- `@medusajs/js-sdk`: the Medusa JS SDK.
- `@medusajs/types`: Medusa's types library, which is useful if you're using TypeScript in your development.

***

## Setup JS SDK

In your project, create the following `config.ts` file:

For admin customizations, create this file at `src/admin/lib/config.ts`.

### Admin (Medusa project)

```ts title="src/admin/lib/sdk.ts"
import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_BACKEND_URL || "/",
  debug: import.meta.env.DEV,
  auth: {
    type: "session",
  },
})
```

### Admin (Medusa Plugin)

```ts title="src/admin/lib/sdk.ts"
import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: __BACKEND_URL__ || "/",
  debug: import.meta.env.DEV,
  auth: {
    type: "session",
  },
})
```

### Storefront

```ts title="sdk.ts"
import Medusa from "@medusajs/js-sdk"

let MEDUSA_BACKEND_URL = "http://localhost:9000"

if (process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL) {
  MEDUSA_BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
}

export const sdk = new Medusa({
  baseUrl: MEDUSA_BACKEND_URL,
  debug: process.env.NODE_ENV === "development",
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
})
```

In Medusa Admin customizations that are created in a Medusa project, you use `import.meta.env` to access environment variables, whereas in customizations built in a Medusa plugin, you use the global variable `__BACKEND_URL__` to access the backend URL. You can learn more in the [Admin Environment Variables](https://docs.medusajs.com/learn/fundamentals/admin/environment-variables) chapter.

### JS SDK Configurations

The `Medusa` initializer accepts as a parameter an object with the following properties:

|Property|Description|Default|
|---|---|---|---|---|
|\`baseUrl\`|A required string indicating the URL to the Medusa backend.|-|
|\`publishableKey\`|A string indicating the publishable API key to use in the storefront. You can retrieve it from the Medusa Admin.|-|
|\`auth.type\`|A string that specifies the user authentication method to use.|-|
|\`auth.jwtTokenStorageKey\`|A string that, when |\`medusa\_auth\_token\`|
|\`auth.jwtTokenStorageMethod\`|A string that, when |\`local\`|
|\`auth.storage\`|This option is only available after Medusa v2.5.1. It's an object or class that's used when |-|
|\`auth.fetchCredentials\`|By default, if |\`include\`|
|\`globalHeaders\`|An object of key-value pairs indicating headers to pass in all requests, where the key indicates the name of the header field.|-|
|\`apiKey\`|A string indicating the admin user's API key. If specified, it's used to send authenticated requests.|-|
|\`debug\`|A boolean indicating whether to show debug messages of requests sent in the console. This is useful during development.|\`false\`|
|\`logger\`|Replace the logger used by the JS SDK to log messages. The logger must be a class or object having the following methods:|JavaScript's |

***

## Manage Authentication in JS SDK

The JS SDK supports different types of authentication methods and allow you to flexibly configure them.

To learn more about configuring authentication in the JS SDK and sending authenticated requests, refer to the [Authentication](https://docs.medusajs.com/js-sdk/auth/overview) guide.

***

## Send Requests to Custom Routes

The sidebar shows the different methods that you can use to send requests to Medusa's API routes.

To send requests to custom routes, the JS SDK has a `client.fetch` method that wraps the [JavaScript Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) that you can use. The method automatically appends configurations and headers, such as authentication headers, to your request.

For example, to send a request to a custom route at `http://localhost:9000/custom`:

### GET

```ts
sdk.client.fetch(`/custom`)
.then((data) => {
  console.log(data)
})
```

### POST

```ts
sdk.client.fetch(`/custom`, {
  method: "post",
  body: {
    id: "123",
  },
}).then((data) => {
  console.log(data)
})
```

### DELETE

```ts
sdk.client.fetch(`/custom`, {
  method: "delete",
}).then(() => {
  console.log("success")
})
```

The `fetch` method accepts as a first parameter the route's path relative to the `baseUrl` configuration you passed when you initialized the SDK.

In the second parameter, you can pass an object of [request configurations](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit). You don't need to configure the content-type to be JSON, or stringify the `body` or `query` value, as that's handled by the method.

The method returns a Promise that, when resolved, has the data returned by the request. If the request returns a JSON object, it'll be automatically parsed to a JavaScript object and returned.

***

## Stream Server-Sent Events

The JS SDK supports streaming server-sent events (SSE) using the `client.fetchStream` method. This method is useful when you want to receive real-time updates from the server.

For example, consider you have the following custom API route at `src/api/admin/stream/route.ts`:

```ts title="src/api/admin/stream/route.ts"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const interval = setInterval(() => {
    res.write("data: Streaming data...\n\n")
  }, 3000)

  req.on("close", () => {
    clearInterval(interval)
    res.end()
  })
  
  req.on("end", () => {
    clearInterval(interval)
    res.end()
  })
}
```

Then, you can use the `client.fetchStream` method in a UI route to receive the streaming data:

```tsx title="src/admin/route/stream/page.tsx"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Button, Text } from "@medusajs/ui"
import { useState } from "react"
import { sdk } from "../../lib/sdk"

const StreamTestPage = () => {
  const [messages, setMessages] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [abortStream, setAbortStream] = useState<(() => void) | null>(null)

  const startStream = async () => {
    setIsStreaming(true)
    setMessages([])
    
    const { stream, abort } = await sdk.client.fetchStream("/admin/stream")

    if (!stream) {
      console.error("Failed to start stream")
      setIsStreaming(false)
      return
    }

    // Store the abort function for the abort button
    setAbortStream(() => abort)

    try {
      for await (const chunk of stream) {
        // Since the server sends plain text, convert to string
        const message = typeof chunk === "string" ? chunk : (chunk.data || String(chunk))
        setMessages((prev) => [...prev, message.trim()])
      }
    } catch (error) {
      // Don't log abort errors as they're expected when user clicks abort
      if (error instanceof Error && error.name !== "AbortError") {
        console.error("Stream error:", error)
      }
    } finally {
      setIsStreaming(false)
      setAbortStream(null)
    }
  }

  const handleAbort = () => {
    if (abortStream) {
      abortStream()
      setIsStreaming(false)
      setAbortStream(null)
    }
  }

  return (
    <Container className="p-6">
      <Heading level="h1" className="mb-6">
        fetchStream Example
      </Heading>
      
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button 
            onClick={startStream} 
            disabled={isStreaming}
            variant="primary"
          >
            {isStreaming ? "Streaming..." : "Start Stream"}
          </Button>
          
          <Button 
            onClick={handleAbort} 
            disabled={!isStreaming}
            variant="secondary"
          >
            Abort Stream
          </Button>
        </div>
        
        <div className="border rounded p-4 h-64 overflow-y-auto bg-ui-bg-subtle">
          {messages.length === 0 ? (
            <Text className="text-ui-fg-muted">No messages yet...</Text>
          ) : (
            messages.map((msg, index) => (
              <div key={index} className="mb-2 text-sm">
                {msg}
              </div>
            ))
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Stream Test",
})

export default StreamTestPage
```

`fetchStream` accepts the same parameters as `fetch`, but it returns an object having two properties:

- `stream`: An [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator) that you can use to iterate over the streaming data.
- `abort`: A function that you can call to abort the stream. This is useful when you want to stop receiving data from the server.

In this example, when the user clicks the "Start Stream" button, you start the stream and listen for incoming data. The data is received as chunks, which you can process and display in the UI.

***

## Handle Errors

If an error occurs in a request, the JS SDK throws a `FetchError` object. This object has the following properties:

- `status`: The HTTP status code of the response.
- `statusText`: The error code. For example, `Unauthorized`.
- `message`: The error message. For example, `Invalid credentials`.

You can use these properties to handle errors in your application.

For example:

### Promise

```ts
sdk.store.customer.listAddress()
.then(({ addresses, count, offset, limit }) => {
  // no errors occurred
  // do something with the data
  console.log(addresses)
})
.catch((error) => {
  const fetchError = error as FetchError

  if (fetchError.statusText === "Unauthorized") {
    // redirect to login page
  } else {
    // handle other errors
  }
})
```

### Async/Await

```ts
try {
  const { 
    addresses, 
    count, 
    offset, 
    limit,
  } = await sdk.store.customer.listAddress()
  // no errors occurred
  // do something with the data
  console.log(addresses)
} catch (error) {
  const fetchError = error as FetchError

  if (fetchError.statusText === "Unauthorized") {
    // redirect to login page
  } else {
    // handle other errors
  }
}
```

In the example above, you handle errors in two ways:

- Since the JS SDK's methods return a Promise, you can use the `catch` method to handle errors.
- You can use the `try...catch` statement to handle errors when using `async/await`. This is useful when you're executing the methods as part of a larger function.

In the `catch` method or statement, you have access to the error object of type `FetchError`.

An example of handling the error is to check if the error's `statusText` is `Unauthorized`. If so, you can redirect the customer to the login page. Otherwise, you can handle other errors by showing an alert, for example.

***

## Pass Headers in Requests

There are two ways to pass custom headers in requests when using the JS SDK:

1. Using the `globalHeaders` configuration: This is useful when you want to pass the same headers in all requests. For example, if you want to pass a custom header for tracking purposes:

```ts
const sdk = new Medusa({
  // ...
  globalHeaders: {
    "x-tracking-id": "123456789",
  },
})
```

2. Using the headers parameter of a specific method. Every method has as a last parameter a headers parameter, which is an object of headers to pass in the request. This is useful when you want to pass a custom header in specific requests. For example, to disable HTTP compression for specific requests:

```ts
sdk.store.product.list({
  limit,
  offset,
}, {
  "x-no-compression": "false",
})
```

In the example above, you pass the `x-no-compression` header in the request to disable HTTP compression. You pass it as the last parameter of the `sdk.store.product.list` method.

The JS SDK appends request-specific headers to authentication headers and headers configured in the `globalHeaders` configuration. So, in the example above, the `x-no-compression` header is passed in the request along with the authentication headers and any headers configured in the `globalHeaders` configuration.

***

## Localization with JS SDK

### Prerequisites

- [Translation Module Configured](https://docs.medusajs.com/commerce-modules/translation#configure-translation-module)

If you support [localization](https://docs.medusajs.com/storefront-development/localization) in your storefront, you can use the `setLocale` method of the JS SDK.

The `setLocale` method stores the locale in the JS SDK to pass the it as a `x-medusa-locale` header in all subsequent requests. Also, if your application supports `localStorage`, the method sets the locale in the `medusa_locale` key of the `localStorage`.

For example, to set the locale to French (France):

```ts
sdk.setLocale("fr-FR")
// products content is fetched in French
const { products } = await sdk.store.product.list()
```

The `setLocale` method accepts the locale string in the [IETF BCP 47 standard](https://gist.github.com/typpo/b2b828a35e683b9bf8db91b5404f1bd1). All subsequent requests sent using the JS SDK will include the specified locale in the `x-medusa-locale` header.

In the above example, the product content, such as title and description, is fetched in French and falls back to the original content if translations aren't available.

You can also retrieve the currently set locale using the `getLocale` method:

```ts
const currentLocale = sdk.getLocale()
console.log(currentLocale) // "fr-FR"
```

Learn more about localization and translations in the [Translation Module](https://docs.medusajs.com/commerce-modules/translation) guide.

***

## Medusa JS SDK Tips

### Use Tanstack (React) Query in Admin Customizations

In admin customizations, use [Tanstack Query](https://tanstack.com/query/latest) with the JS SDK to send requests to custom or existing API routes.

Tanstack Query is installed by default in your Medusa application.

Do not install Tanstack Query as that will cause unexpected errors in your development. If you prefer installing it for better auto-completion in your code editor, make sure to install `v5.64.2` as a development dependency.

Use the [configured SDK](#setup-js-sdk) with the [useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery#usequery) Tanstack Query hook to send `GET` requests, and [useMutation](https://tanstack.com/query/latest/docs/framework/react/reference/useMutation#usemutation) hook to send `POST` or `DELETE` requests.

For example:

### Query

```tsx title="src/admin/widgets/product-widget.ts"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../lib/config"
import { DetailWidgetProps, HttpTypes } from "@medusajs/framework/types"

const ProductWidget = () => {
  const { data, isLoading } = useQuery({
    queryFn: () => sdk.admin.product.list(),
    queryKey: ["products"],
  })
  
  return (
    <Container className="divide-y p-0">
      {isLoading && <span>Loading...</span>}
      {data?.products && (
        <ul>
          {data.products.map((product) => (
            <li key={product.id}>{product.title}</li>
          ))}
        </ul>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default ProductWidget
```

### Mutation

```tsx title="src/admin/widgets/product-widget.ts"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { sdk } from "../lib/config"
import { DetailWidgetProps, HttpTypes } from "@medusajs/framework/types"

const ProductWidget = ({ 
  data: productData,
}: DetailWidgetProps<HttpTypes.AdminProduct>) => {
  const { mutateAsync } = useMutation({
    mutationFn: (payload: HttpTypes.AdminUpdateProduct) => 
      sdk.admin.product.update(productData.id, payload),
    onSuccess: () => alert("updated product"),
  })

  const handleUpdate = () => {
    mutateAsync({
      title: "New Product Title",
    })
  }
  
  return (
    <Container className="divide-y p-0">
      <Button onClick={handleUpdate}>Update Title</Button>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.before",
})

export default ProductWidget
```

Refer to Tanstack Query's documentation to learn more about sending [Queries](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery#usequery) and [Mutations](https://tanstack.com/query/latest/docs/framework/react/reference/useMutation#usemutation).

### Cache in Next.js Projects

Every method of the SDK that sends requests accepts as a last parameter an object of key-value headers to pass in the request.

In Next.js storefronts or projects, pass the `next.tags` header in the last parameter for data caching.

For example:

```ts highlights={[["2", "next"], ["3", "tags", "An array of tags to cache the data under."]]}
sdk.store.product.list({}, {
  next: {
    tags: ["products"],
  },
})
```

The `tags` property accepts an array of tags that the data is cached under.

Then, to purge the cache later, use Next.js's `revalidateTag` utility:

```ts
import { revalidateTag } from "next/cache"

// ...

revalidateTag("products")
```

Learn more in the [Next.js documentation](https://nextjs.org/docs/app/building-your-application/caching#fetch-optionsnexttags-and-revalidatetag).
