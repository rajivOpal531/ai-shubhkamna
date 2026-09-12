FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    U2NET_HOME=/models

WORKDIR /srv

# libraqm: HarfBuzz text shaping so Devanagari and other Indic scripts render with correct
# conjuncts/matras in the name line. libgl1/libglib2.0-0: onnxruntime/opencv deps for rembg.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libraqm0 libfribidi0 libharfbuzz0b \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model weights into the image so a cold container never downloads at request time.
RUN python -c "from rembg import new_session; new_session('isnet-general-use')"

# Fail the build if Pillow cannot see libraqm (text shaping for Indic scripts would silently break).
RUN python -c "from PIL import features; assert features.check('raqm'), 'libraqm not available to Pillow'"

COPY app ./app
COPY templates ./templates

EXPOSE 8000
# --forwarded-allow-ips="*" makes uvicorn rewrite request.client from X-Forwarded-For (leftmost
# entry, client-controlled). The per-IP rate limit deliberately does NOT rely on request.client:
# it reads the RIGHTMOST X-Forwarded-For entry, which the platform proxy appends. Narrow this
# flag to the proxy range if Railway publishes one.
CMD uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips="*"
