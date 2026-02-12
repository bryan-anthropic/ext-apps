package io.modelcontextprotocol.examples;

import io.modelcontextprotocol.json.jackson.JacksonMcpJsonMapperSupplier;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.server.transport.StdioServerTransportProvider;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.eclipse.jetty.ee10.servlet.FilterHolder;
import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;

import java.io.IOException;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;

/**
 * Minimal MCP App server in Java: a "get-time" tool with an inline HTML UI.
 *
 * HTTP (default):  java -jar basic-server-java.jar
 * Stdio:           java -jar basic-server-java.jar --stdio
 */
public class Main {

    static final String RESOURCE_URI = "ui://get-time/index.html";
    static final String RESOURCE_MIME = "text/html;profile=mcp-app";

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

    static final McpSchema.Tool TOOL = McpSchema.Tool.builder()
            .name("get-time")
            .description("Returns the current server time as an ISO 8601 string")
            .inputSchema(new McpSchema.JsonSchema("object", null, null, null, null, null))
            .meta(Map.of("ui", Map.of("resourceUri", RESOURCE_URI)))
            .build();

    static final McpSchema.Resource RESOURCE = McpSchema.Resource.builder()
            .uri(RESOURCE_URI).name("Get Time UI").mimeType(RESOURCE_MIME).build();

    static McpSchema.CallToolResult getTime() {
        return McpSchema.CallToolResult.builder()
                .content(List.of(new McpSchema.TextContent(Instant.now().toString()))).build();
    }

    static McpSchema.ReadResourceResult readResource() {
        return new McpSchema.ReadResourceResult(List.of(new McpSchema.TextResourceContents(
                RESOURCE_URI, RESOURCE_MIME, UI_HTML,
                Map.of("ui", Map.of("csp", Map.of("resourceDomains", List.of("https://unpkg.com")))))));
    }

    // ── entry point ──────────────────────────────────────────────────────

    public static void main(String[] args) throws Exception {
        var json = new JacksonMcpJsonMapperSupplier().get();

        if (List.of(args).contains("--stdio")) {
            McpServer.sync(new StdioServerTransportProvider(json))
                    .serverInfo("basic-server-java", "1.0.0")
                    .tools(new McpServerFeatures.SyncToolSpecification(TOOL, (ex, a) -> getTime()))
                    .resources(new McpServerFeatures.SyncResourceSpecification(RESOURCE, (ex, r) -> readResource()))
                    .build();
            return; // stdin drives the lifecycle
        }

        // Stateless HTTP (matches JS examples)
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3001"));
        var transport = HttpServletStatelessServerTransport.builder().jsonMapper(json).build();

        McpServer.sync(transport)
                .serverInfo("basic-server-java", "1.0.0")
                .tools(new McpStatelessServerFeatures.SyncToolSpecification(TOOL, (ctx, r) -> getTime()))
                .resources(new McpStatelessServerFeatures.SyncResourceSpecification(RESOURCE, (ctx, r) -> readResource()))
                .build();

        var context = new ServletContextHandler();
        context.addFilter(new FilterHolder((Filter) (req, res, chain) -> {
            ((HttpServletResponse) res).setHeader("Access-Control-Allow-Origin", "*");
            ((HttpServletResponse) res).setHeader("Access-Control-Allow-Headers", "*");
            if ("OPTIONS".equalsIgnoreCase(((HttpServletRequest) req).getMethod())) {
                ((HttpServletResponse) res).setStatus(200);
                return;
            }
            chain.doFilter(req, res);
        }), "/*", EnumSet.of(DispatcherType.REQUEST));
        context.addServlet(new ServletHolder(transport), "/mcp");

        var server = new org.eclipse.jetty.server.Server(port);
        server.setHandler(context);
        server.start();
        System.out.println("MCP server listening on http://localhost:" + port + "/mcp");
        server.join();
    }
}
