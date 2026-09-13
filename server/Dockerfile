FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    U2NET_HOME=/models

WORKDIR /srv

# libraqm: HarfBuzz text shaping so Devanagari and other Indic scripts render with correct
# conjuncts/matras in the name line. libglib2.0-0 is required by opencv-python-headless (pulled in
# by rembg); libgl1 is kept defensively for onnxruntime -- try dropping it once a build proves it
# unnecessary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libraqm0 libfribidi0 libharfbuzz0b \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model weights into the image so a cold container never downloads at request time.
# pooch downloads via a NamedTemporaryFile (mode 0600) and moves it into place, so the baked file is
# root-only; open it up or the non-root runtime user hits PermissionError while hash-checking it.
RUN python -c "from rembg import new_session; new_session('isnet-general-use')" \
 && chmod -R a+rX /models

# Fail the build if Pillow cannot see libraqm (text shaping for Indic scripts would silently break).
RUN python -c "from PIL import features; assert features.check('raqm'), 'libraqm not available to Pillow'"

COPY app ./app
COPY templates ./templates

# Drop root for everything the app does at runtime; /models and /srv were baked by root above and
# are made world-readable (see the chmod after the model bake), which is all the app needs.
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin appuser
ENV HOME=/tmp
USER 10001

EXPOSE 8000
# Railway injects PORT; the default of 8000 below is for local docker run.
# --forwarded-allow-ips='*' makes uvicorn rewrite request.client from X-Forwarded-For (leftmost
# entry, client-controlled). The per-IP rate limit deliberately does NOT rely on request.client:
# it reads the RIGHTMOST X-Forwarded-For entry, which the platform proxy appends. Narrow this
# flag to the proxy range if Railway publishes one.
# Exec form + an explicit `exec` so uvicorn is PID 1 and receives Railway's SIGTERM directly;
# the `sh -c` wrapper is only there to expand ${PORT}.
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
