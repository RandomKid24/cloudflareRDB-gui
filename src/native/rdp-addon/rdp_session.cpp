#include "rdp_session.h"
#include <freerdp/gdi/gdi.h>
#include <freerdp/graphics.h>
#include <freerdp/event.h>
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

  // Initialize GDI with the correct pixel format after connection is established
  if (gdi_init(instance, PIXEL_FORMAT_BGRX32) != TRUE) {
    self->lastError_ = "gdi_init failed in PostConnect";
    if (self->listener_) self->listener_->onError(self->lastError_.c_str());
    return FALSE;
  }

  // Register update callbacks after GDI is ready
  self->context_->update->BeginPaint = beginPaint;
  self->context_->update->EndPaint = endPaint;
  self->context_->update->BitmapUpdate = bitmapUpdate;
  self->context_->update->SurfaceBits = surfaceBits;
  self->context_->update->DesktopResize = desktopResize;

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

  freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_Authentication, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_IgnoreCertificate, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_NSCodec, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_RemoteFxCodec, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_FastPathOutput, TRUE);

  // Register PostConnect callback — gdi_init must happen after connection
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
  while (running_ && connected_) {
    DWORD status = freerdp_check_fds(instance_);
    if (status != TRUE) {
      if (listener_) listener_->onDisconnect("freerdp_check_fds failed");
      connected_ = false;
      break;
    }

    UINT32 wstatus = freerdp_get_last_error(context_);
    if (wstatus != FREERDP_ERROR_SUCCESS) {
      if (running_) {
        char buf[128];
        snprintf(buf, sizeof(buf), "RDP error: code=%u", wstatus);
        if (listener_) listener_->onError(buf);
        connected_ = false;
      }
      break;
    }

    Sleep(50);
  }
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
  return TRUE;
}

BOOL RdpSession::bitmapUpdate(rdpContext* ctx, const BITMAP_UPDATE* bitmap) {
  RdpSession* self = getSelf(ctx);
  if (!self || !self->listener_) return TRUE;

  for (int i = 0; i < bitmap->number; i++) {
    const BITMAP_DATA* bmp = &bitmap->rectangles[i];
    int x = bmp->destLeft;
    int y = bmp->destTop;
    int w = bmp->destRight - bmp->destLeft;
    int h = bmp->destBottom - bmp->destTop;

    if (w <= 0 || h <= 0) continue;
    if (bmp->bitmapLength <= 0) continue;

    self->listener_->onBitmapUpdate(x, y, w, h,
      bmp->bitmapDataStream, bmp->bitmapLength);
  }
  return TRUE;
}

BOOL RdpSession::surfaceBits(rdpContext* ctx, const SURFACE_BITS_COMMAND* cmd) {
  RdpSession* self = getSelf(ctx);
  if (!self || !self->listener_) return TRUE;

  int w = cmd->bmp.width;
  int h = cmd->bmp.height;

  if (w <= 0 || h <= 0 || !cmd->bmp.bitmapData || cmd->bmp.bitmapDataLength <= 0)
    return TRUE;

  self->listener_->onBitmapUpdate(cmd->destLeft, cmd->destTop, w, h,
    cmd->bmp.bitmapData, cmd->bmp.bitmapDataLength);
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
