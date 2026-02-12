package io.modelcontextprotocol.examples;

import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpServerTransportProvider;
import io.modelcontextprotocol.spec.McpStreamableServerTransportProvider;

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

    static void createServer(McpServerTransportProvider transport) {
        configureServer(McpServer.sync(transport));
    }

    static void createServer(McpStreamableServerTransportProvider transport) {
        configureServer(McpServer.sync(transport));
    }

    private static void configureServer(McpServer.SyncSpecification<?> spec) {
        var tool = new McpServerFeatures.SyncToolSpecification(
                McpSchema.Tool.builder()
                        .name("get-time")
                        .description("Returns the current server time as an ISO 8601 string")
                        .inputSchema(new McpSchema.JsonSchema("object", null, null, null, null, null))
                        .meta(Map.of(
                                // New key (ui.resourceUri) + legacy flat key (ui/resourceUri) for compat
                                "ui", Map.of("resourceUri", RESOURCE_URI),
                                "ui/resourceUri", RESOURCE_URI
                        ))
                        .build(),
                (exchange, arguments) -> McpSchema.CallToolResult.builder()
                        .content(List.of(new McpSchema.TextContent(Instant.now().toString())))
                        .isError(false)
                        .build()
        );

        var resource = new McpServerFeatures.SyncResourceSpecification(
                McpSchema.Resource.builder()
                        .uri(RESOURCE_URI)
                        .name("Get Time UI")
                        .mimeType(RESOURCE_MIME_TYPE)
                        .build(),
                (exchange, request) -> new McpSchema.ReadResourceResult(List.of(
                        new McpSchema.TextResourceContents(RESOURCE_URI, RESOURCE_MIME_TYPE, UI_HTML)
                ))
        );

        spec.serverInfo("basic-server-java", "1.0.0")
                .capabilities(McpSchema.ServerCapabilities.builder()
                        .tools(true)
                        .resources(false, false)
                        .build())
                .tools(tool)
                .resources(resource)
                .build();
    }
}
