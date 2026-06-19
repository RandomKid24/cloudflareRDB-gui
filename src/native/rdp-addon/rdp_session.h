#pragma once

#include <napi.h>
#include <freerdp/freerdp.h>
#include <freerdp/client/cmdline.h>
#include <freerdp/constants.h>
#include <freerdp/codec/color.h>
#include <winpr/wtypes.h>
#include <thread>
#include <atomic>
#include <memory>
#include <functional>

class RdpFrameListener {
public:
  virtual ~RdpFrameListener() = default;
  virtual void onBitmapUpdate(int x, int y, int w, int h, const void* data, size_t size) = 0;
  virtual void onResize(int w, int h) = 0;
  virtual void onDisconnect(const char* reason) = 0;
  virtual void onError(const char* msg) = 0;
};

class RdpSession {
public:
  RdpSession(const std::string& host, int port,
             int width, int height,
             const std::string& username,
             const std::string& password,
             RdpFrameListener* listener);
  ~RdpSession();

  bool connect();
  void disconnect();
  bool isConnected() const { return connected_; }
  const std::string& lastError() const { return lastError_; }

  void sendPointerEvent(int flags, int x, int y);
  void sendKeyboardEvent(int flags, UINT16 code);
  void resize(int width, int height);

private:
  static BOOL beginPaint(rdpContext* ctx);
  static BOOL endPaint(rdpContext* ctx);
  static BOOL bitmapUpdate(rdpContext* ctx, const BITMAP_UPDATE* bitmap);
  static BOOL surfaceBits(rdpContext* ctx, const SURFACE_BITS_COMMAND* cmd);
  static BOOL desktopResize(rdpContext* ctx);
  static BOOL postConnectCallback(freerdp* instance);


  freerdp* instance_ = nullptr;
  rdpContext* context_ = nullptr;
  std::thread* updateThread_ = nullptr;
  std::atomic<bool> connected_{false};
  std::atomic<bool> running_{false};
  RdpFrameListener* listener_ = nullptr;

  std::string lastError_;
  std::string host_;
  int port_;
  int width_;
  int height_;
  std::string username_;
  std::string password_;

  void pump();

  static RdpSession* getSelf(rdpContext* ctx);
};
