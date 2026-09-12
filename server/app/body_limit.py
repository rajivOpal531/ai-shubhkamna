"""ASGI-level cap on request body size.

FastAPI spools the whole multipart body (to memory, then to a temp file) before the
endpoint function is ever called, so a size check inside the route runs too late: an
unauthenticated caller could fill the disk just by POSTing. This middleware sits above
routing, counts bytes as they arrive and answers 413 itself.
"""
from __future__ import annotations

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class BodyLimitMiddleware:
    """Rejects a declared content-length over `max_bytes` outright, and stops streaming
    (413 if nothing has been sent yet) once the bytes actually received exceed it."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = Headers(scope=scope).get("content-length", "")
        if declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(scope, send)
            return

        state = {"received": 0, "started": False, "answered": False, "over": False}

        async def guarded_receive() -> Message:
            if state["over"]:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] != "http.request":
                return message
            state["received"] += len(message.get("body", b""))
            if state["received"] <= self.max_bytes:
                return message
            state["over"] = True
            if not state["started"]:  # nothing sent yet, so we can still answer ourselves
                state["answered"] = True
                await self._reject(scope, send)
            return {"type": "http.disconnect"}

        async def guarded_send(message: Message) -> None:
            if state["answered"]:
                return  # our 413 already ended this exchange; drop whatever the app says next
            if message["type"] == "http.response.start":
                state["started"] = True
            await send(message)

        try:
            await self.app(scope, guarded_receive, guarded_send)
        except Exception:
            if not state["answered"]:
                raise  # a genuine failure, not the disconnect we faked

    async def _reject(self, scope: Scope, send: Send) -> None:
        async def _no_receive() -> Message:  # Response never reads it
            return {"type": "http.disconnect"}

        megabytes = self.max_bytes // (1024 * 1024)
        response = JSONResponse({"detail": f"Body larger than {megabytes} MB"}, status_code=413)
        await response(scope, _no_receive, send)
