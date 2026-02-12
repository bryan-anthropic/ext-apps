package io.modelcontextprotocol.examples;

import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpServerTransportProvider;
import io.modelcontextprotocol.spec.McpStatelessServerTransport;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * MCP server definition: registers the "get-time" tool and its inline HTML UI resource.
 */
public class Server {

    static final String RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
    static final String RESOURCE_URI = "ui://get-time/index.html";

    // Inline HTML: loads @modelcontextprotocol/ext-apps from CDN, displays server time.
    static final String UI_HTML = """
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="color-scheme" content="light dark">
              <title>Get Time</title>
            </head>
            <body>
              <p><strong>Server time:</strong> <code id="time">—</code></p>
              <script type="module">
                import { App } from 'https://unpkg.com/@modelcontextprotocol/ext-apps@1.0.1/dist/src/app-with-deps.js';
                const app = new App({ name: 'get-time-app', version: '1.0.0' });
                app.ontoolinput = ({ toolInput }) => {
                  document.getElementById('time').textContent =
                    toolInput.structuredContent?.time ?? toolInput.content?.[0]?.text ?? '?';
                };
                app.connect();
              </script>
            </body>
            </html>
            """;

    private static final McpSchema.Tool TOOL_DEF = McpSchema.Tool.builder()
            .name("get-time")
            .description("Returns the current server time as an ISO 8601 string")
            .inputSchema(new McpSchema.JsonSchema("object", null, null, null, null, null))
            .meta(Map.of(
                    "ui", Map.of("resourceUri", RESOURCE_URI),
                    "ui/resourceUri", RESOURCE_URI
            ))
            .build();

    private static final McpSchema.Resource RESOURCE_DEF = McpSchema.Resource.builder()
            .uri(RESOURCE_URI)
            .name("Get Time UI")
            .mimeType(RESOURCE_MIME_TYPE)
            .build();

    private static McpSchema.CallToolResult handleGetTime() {
        return McpSchema.CallToolResult.builder()
                .content(List.of(new McpSchema.TextContent(Instant.now().toString())))
                .isError(false)
                .build();
    }

    private static McpSchema.ReadResourceResult handleReadResource() {
        return new McpSchema.ReadResourceResult(List.of(
                new McpSchema.TextResourceContents(RESOURCE_URI, RESOURCE_MIME_TYPE, UI_HTML)
        ));
    }

    /** Stateful server (stdio transport). */
    static void createServer(McpServerTransportProvider transport) {
        McpServer.sync(transport)
                .serverInfo("basic-server-java", "1.0.0")
                .capabilities(McpSchema.ServerCapabilities.builder()
                        .tools(true)
                        .resources(false, false)
                        .build())
                .tools(new McpServerFeatures.SyncToolSpecification(
                        TOOL_DEF, (exchange, arguments) -> handleGetTime()))
                .resources(new McpServerFeatures.SyncResourceSpecification(
                        RESOURCE_DEF, (exchange, request) -> handleReadResource()))
                .build();
    }

    /** Stateless server (HTTP transport, matches JS examples' sessionIdGenerator: undefined). */
    static void createStatelessServer(McpStatelessServerTransport transport) {
        McpServer.sync(transport)
                .serverInfo("basic-server-java", "1.0.0")
                .capabilities(McpSchema.ServerCapabilities.builder()
                        .tools(true)
                        .resources(false, false)
                        .build())
                .tools(new McpStatelessServerFeatures.SyncToolSpecification(
                        TOOL_DEF, (ctx, request) -> handleGetTime()))
                .resources(new McpStatelessServerFeatures.SyncResourceSpecification(
                        RESOURCE_DEF, (ctx, request) -> handleReadResource()))
                .build();
    }
}
