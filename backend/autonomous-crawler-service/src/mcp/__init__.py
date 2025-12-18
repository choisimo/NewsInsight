"""
MCP (Model Context Protocol) Adapter Module

MCP 서버들을 ML Add-on으로 래핑하여 REST API로 노출합니다.
"""

from src.mcp.client import MCPClient
from src.mcp.adapter import MCPAdapter, get_mcp_adapter
from src.mcp.router import router as mcp_router

__all__ = ["MCPClient", "MCPAdapter", "get_mcp_adapter", "mcp_router"]
