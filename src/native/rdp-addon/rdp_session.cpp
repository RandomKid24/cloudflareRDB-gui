#include "rdp_session.h"
#include <freerdp/gdi/gdi.h>
#include <freerdp/input.h>

struct RdpSessionContext {
  rdpContext _ctx;
  RdpSession* session;
};

RdpSession::RdpSession(const std::string& host, int port,
                       int width, int height,
                       const std::string& username,
                       const std::string& password,
                       RdpFrameListener* listener)
  : host_(host), port_(port), width_(width), height_(height),
    username_(username), password_(password), listener_(listener) {}

RdpSession::~RdpSession() {
  disconnect();
}

BOOL RdpSession::postConnectCallback(freerdp* instance) {
  RdpSession* self = getSelf(instance->context);
  if (!self) return FALSE;

  fprintf(stderr, "[RDP] postConnect called, gdi=%p\n", (void*)instance->context->gdi);

  if (gdi_init(instance, PIXEL_FORMAT_BGRX32) != TRUE) {
    self->lastError_ = "gdi_init failed in PostConnect";
    if (self->listener_) self->listener_->onError(self->lastError_.c_str());
    return FALSE;
  }

  fprintf(stderr, "[RDP] gdi_init OK, primary_buffer=%p\n", (void*)instance->context->gdi->primary_buffer);

  fprintf(stderr, "[RDP] registering callbacks via context_->update (%p)\n", (void*)self->context_->update);
  self->context_->update->BeginPaint = beginPaint;
  self->context_->update->EndPaint = endPaint;
  self->context_->update->DesktopResize = desktopResize;
  fprintf(stderr, "[RDP] callbacks set: EndPaint=%p, DesktopResize=%p\n",
          (void*)self->context_->update->EndPaint,
          (void*)self->context_->update->DesktopResize);

  return TRUE;
}

bool RdpSession::connect() {
  instance_ = freerdp_new();
  if (!instance_) {
    lastError_ = "freerdp_new failed";
    if (listener_) listener_->onError(lastError_.c_str());
    return false;
  }

  instance_->ContextSize = sizeof(RdpSessionContext);
  instance_->ContextNew = nullptr;
  instance_->ContextFree = nullptr;

  if (freerdp_context_new(instance_) != TRUE) {
    lastError_ = "freerdp_context_new failed";
    if (listener_) listener_->onError(lastError_.c_str());
    freerdp_free(instance_);
    instance_ = nullptr;
    return false;
  }
  context_ = instance_->context;
  ((RdpSessionContext*)context_)->session = this;

  rdpSettings* settings = context_->settings;
  freerdp_settings_set_string(settings, FreeRDP_ServerHostname, host_.c_str());
  freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, port_);
  freerdp_settings_set_uint32(settings, FreeRDP_DesktopWidth, width_);
  freerdp_settings_set_uint32(settings, FreeRDP_DesktopHeight, height_);
  freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32);

  if (!username_.empty())
    freerdp_settings_set_string(settings, FreeRDP_Username, username_.c_str());
  if (!password_.empty())
    freerdp_settings_set_string(settings, FreeRDP_Password, password_.c_str());

#ifdef _WIN32
  freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_TlsSecurity, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_RdpSecurity, TRUE);
#else
  freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, TRUE);
#endif
  freerdp_settings_set_bool(settings, FreeRDP_Authentication, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_IgnoreCertificate, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_NSCodec, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_RemoteFxCodec, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_FastPathOutput, TRUE);

  instance_->PostConnect = postConnectCallback;

  BOOL connectResult = freerdp_connect(instance_);
  if (connectResult != TRUE) {
    UINT32 lastError = freerdp_get_last_error(context_);
    const char* errorStr = freerdp_get_last_error_string(lastError);
    char buf[256];
    if (errorStr) {
      snprintf(buf, sizeof(buf), "freerdp_connect failed: code=%u (%s)", lastError, errorStr);
    } else {
      snprintf(buf, sizeof(buf), "freerdp_connect failed: code=%u", lastError);
    }
    lastError_ = buf;
    if (listener_) listener_->onError(lastError_.c_str());
    freerdp_context_free(instance_);
    freerdp_free(instance_);
    instance_ = nullptr;
    context_ = nullptr;
    return false;
  }

  connected_ = true;
  running_ = true;

  updateThread_ = new std::thread(&RdpSession::pump, this);

  return true;
}

void RdpSession::disconnect() {
  running_ = false;
  connected_ = false;

  if (updateThread_) {
    updateThread_->join();
    delete updateThread_;
    updateThread_ = nullptr;
  }

  if (instance_) {
    if (instance_->context)
      gdi_free(instance_);
    freerdp_disconnect(instance_);
    freerdp_context_free(instance_);
    freerdp_free(instance_);
    instance_ = nullptr;
    context_ = nullptr;
  }
}

void RdpSession::pump() {
  fprintf(stderr, "[RDP] pump started, shall_disconnect=%d\n", freerdp_shall_disconnect(instance_));
  fflush(stderr);
  int consecutiveFailures = 0;
  while (running_ && connected_) {
    HANDLE handles[64];
    DWORD ncount = freerdp_get_event_handles(context_, handles, 64);
    if (ncount == 0) {
      fprintf(stderr, "[RDP] pump: no event handles\n");
      fflush(stderr);
#ifdef _WIN32
      Sleep(10);
#else
      usleep(10000);
#endif
      continue;
    }

    if (!freerdp_check_event_handles(context_)) {
      int shall = freerdp_shall_disconnect(instance_);
      UINT32 err = freerdp_get_last_error(context_);
      const char* errStr = freerdp_get_last_error_string(err);
      fprintf(stderr, "[RDP] pump: check_event_handles failed, shall_disconnect=%d, last_error=%u (%s)\n",
              shall, err, errStr ? errStr : "unknown");
      fflush(stderr);

      if (shall) {
        if (listener_) listener_->onDisconnect("RDP server disconnected");
        connected_ = false;
        break;
      }

      consecutiveFailures++;
      if (consecutiveFailures > 50) {
        fprintf(stderr, "[RDP] pump: too many consecutive failures, forcing disconnect\n");
        fflush(stderr);
        if (listener_) listener_->onDisconnect("RDP pump stalled");
        connected_ = false;
        break;
      }
    } else {
      consecutiveFailures = 0;
    }
#ifdef _WIN32
    Sleep(10);
#else
    usleep(10000);
#endif
  }
  fprintf(stderr, "[RDP] pump exited\n");
  fflush(stderr);
}

void RdpSession::sendPointerEvent(int flags, int x, int y) {
  if (!connected_ || !context_) return;
  freerdp_input_send_mouse_event(context_->input, (UINT16)flags, (UINT16)x, (UINT16)y);
}

void RdpSession::sendKeyboardEvent(int flags, UINT16 code) {
  if (!connected_ || !context_) return;
  freerdp_input_send_keyboard_event(context_->input, (UINT16)flags, (UINT8)code);
}

void RdpSession::resize(int width, int height) {
  width_ = width;
  height_ = height;
}

RdpSession* RdpSession::getSelf(rdpContext* ctx) {
  return ((RdpSessionContext*)ctx)->session;
}

BOOL RdpSession::beginPaint(rdpContext* ctx) {
  return TRUE;
}

BOOL RdpSession::endPaint(rdpContext* ctx) {
  fprintf(stderr, "[RDP] endPaint called\n");
  fflush(stderr);

  RdpSession* self = getSelf(ctx);
  if (!self || !self->listener_) {
    fprintf(stderr, "[RDP] endPaint: no self or listener\n");
    return TRUE;
  }

  rdpGdi* gdi = ctx->gdi;
  if (!gdi || !gdi->primary_buffer) {
    fprintf(stderr, "[RDP] endPaint: no gdi or buffer\n");
    return TRUE;
  }

  HGDI_WND wnd = gdi->primary->hdc->hwnd;
  fprintf(stderr, "[RDP] endPaint: invalid->null=%d\n", wnd->invalid->null);
  fflush(stderr);

  if (wnd->invalid->null)
    return TRUE;

  int x = wnd->invalid->x;
  int y = wnd->invalid->y;
  int w = wnd->invalid->w;
  int h = wnd->invalid->h;

  if (w <= 0 || h <= 0) {
    wnd->invalid->null = TRUE;
    return TRUE;
  }

  int fullW = gdi->width;
  int stride = gdi->stride;
  int bpp = 4;

  const BYTE* src = gdi->primary_buffer;
  std::vector<uint8_t> rgba(w * h * bpp);

  for (int row = 0; row < h; row++) {
    const BYTE* srcRow = src + (y + row) * stride + x * bpp;
    uint8_t* dstRow = rgba.data() + row * w * bpp;
    for (int col = 0; col < w; col++) {
      dstRow[col * 4 + 0] = srcRow[col * 4 + 2];
      dstRow[col * 4 + 1] = srcRow[col * 4 + 1];
      dstRow[col * 4 + 2] = srcRow[col * 4 + 0];
      dstRow[col * 4 + 3] = 255;
    }
  }

  self->listener_->onBitmapUpdate(x, y, w, h, rgba.data(), rgba.size());

  fprintf(stderr, "[RDP] endPaint sent frame: (%d,%d %dx%d)\n", x, y, w, h);
  fflush(stderr);

  wnd->invalid->null = TRUE;
  wnd->ninvalid = 0;

  return TRUE;
}

BOOL RdpSession::desktopResize(rdpContext* ctx) {
  RdpSession* self = getSelf(ctx);
  if (!self || !self->listener_) return TRUE;

  rdpSettings* settings = ctx->settings;
  int newW = freerdp_settings_get_uint32(settings, FreeRDP_DesktopWidth);
  int newH = freerdp_settings_get_uint32(settings, FreeRDP_DesktopHeight);

  self->listener_->onResize(newW, newH);
  return TRUE;
}
