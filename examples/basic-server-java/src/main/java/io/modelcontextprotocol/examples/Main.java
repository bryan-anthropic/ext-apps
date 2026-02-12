package io.modelcontextprotocol.examples;

import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.jackson.JacksonMcpJsonMapperSupplier;
import io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider;
import io.modelcontextprotocol.server.transport.StdioServerTransportProvider;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.eclipse.jetty.ee10.servlet.FilterHolder;
import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;
import java.io.IOException;
import java.util.Arrays;
import java.util.EnumSet;

/**
 * Entry point for the basic-server-java MCP App example.
 *
 * Run with HTTP transport (default, port 3001):
 *   java -jar basic-server-java.jar
 *
 * Run with stdio transport:
 *   java -jar basic-server-java.jar --stdio
 */
public class Main {

    public static void main(String[] args) throws Exception {
        McpJsonMapper jsonMapper = new JacksonMcpJsonMapperSupplier().get();
        if (Arrays.asList(args).contains("--stdio")) {
            runStdio(jsonMapper);
        } else {
            runHttp(jsonMapper);
        }
    }

    static void runStdio(McpJsonMapper jsonMapper) {
        Server.createServer(new StdioServerTransportProvider(jsonMapper));
        // Block until stdin closes (transport drives the lifecycle)
    }

    static void runHttp(McpJsonMapper jsonMapper) throws Exception {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3001"));
        var transport = HttpServletStreamableServerTransportProvider.builder()
                .jsonMapper(jsonMapper)
                .build();

        Server.createServer(transport);

        var context = new ServletContextHandler();
        context.addFilter(new FilterHolder(new CorsFilter()), "/*", EnumSet.of(DispatcherType.REQUEST));
        context.addServlet(new ServletHolder(transport), "/mcp");

        var server = new org.eclipse.jetty.server.Server(port);
        server.setHandler(context);
        server.start();
        System.out.println("MCP server listening on http://localhost:" + port + "/mcp");
        server.join();
    }

    /** Simple CORS filter that allows all origins (mirrors the cors() middleware used by JS examples). */
    static class CorsFilter implements Filter {
        @Override
        public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
                throws IOException, ServletException {
            var response = (HttpServletResponse) res;
            response.setHeader("Access-Control-Allow-Origin", "*");
            response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            response.setHeader("Access-Control-Allow-Headers", "*");

            if ("OPTIONS".equalsIgnoreCase(((HttpServletRequest) req).getMethod())) {
                response.setStatus(HttpServletResponse.SC_OK);
                return;
            }
            chain.doFilter(req, res);
        }
    }
}
