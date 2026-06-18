#include <napi.h>
#include <map>
#include <mutex>
#include "rdp_session.h"

struct SessionHolder {
  RdpSession* session;
  JsFrameListener* listener;
};

static std::map<int, SessionHolder> sessions_;
static std::mutex sessionsMutex_;
static int nextId_ = 1;

class JsFrameListener : public RdpFrameListener {
public:
  JsFrameListener(Napi::ThreadSafeFunction bitmapCb,
                  Napi::ThreadSafeFunction resizeCb,
                  Napi::ThreadSafeFunction disconnectCb,
                  Napi::ThreadSafeFunction errorCb)
    : bitmapCb_(std::move(bitmapCb)),
      resizeCb_(std::move(resizeCb)),
      disconnectCb_(std::move(disconnectCb)),
      errorCb_(std::move(errorCb)) {}

  ~JsFrameListener() {
    bitmapCb_.Release();
    resizeCb_.Release();
    disconnectCb_.Release();
    errorCb_.Release();
  }

  void onBitmapUpdate(int x, int y, int w, int h, const void* data, size_t size) override {
    auto copy = std::make_shared<std::vector<uint8_t>>(
      static_cast<const uint8_t*>(data),
      static_cast<const uint8_t*>(data) + size);

    bitmapCb_.BlockingCall([x, y, w, h, copy](Napi::Env env, Napi::Function jsCallback) {
      auto buf = Napi::Buffer<uint8_t>::Copy(env, copy->data(), copy->size());
      jsCallback.Call({
        Napi::Number::New(env, x),
        Napi::Number::New(env, y),
        Napi::Number::New(env, w),
        Napi::Number::New(env, h),
        buf,
      });
    });
  }

  void onResize(int w, int h) override {
    resizeCb_.BlockingCall([w, h](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({ Napi::Number::New(env, w), Napi::Number::New(env, h) });
    });
  }

  void onDisconnect(const char* reason) override {
    std::string r(reason);
    disconnectCb_.BlockingCall([r](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({ Napi::String::New(env, r) });
    });
  }

  void onError(const char* msg) override {
    std::string m(msg);
    errorCb_.BlockingCall([m](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({ Napi::String::New(env, m) });
    });
  }

private:
  Napi::ThreadSafeFunction bitmapCb_;
  Napi::ThreadSafeFunction resizeCb_;
  Napi::ThreadSafeFunction disconnectCb_;
  Napi::ThreadSafeFunction errorCb_;
};

static Napi::Value CreateSession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 8) {
    Napi::TypeError::New(env, "Expected 8 arguments").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string host = info[0].As<Napi::String>().Utf8Value();
  int port = info[1].As<Napi::Number>().Int32Value();
  int width = info[2].As<Napi::Number>().Int32Value();
  int height = info[3].As<Napi::Number>().Int32Value();
  std::string username = info[4].As<Napi::String>().Utf8Value();
  std::string password = info[5].As<Napi::String>().Utf8Value();
  Napi::Function onBitmap = info[6].As<Napi::Function>();
  Napi::Function onEvent = info[7].As<Napi::Function>();

  auto bitmapTsFn = Napi::ThreadSafeFunction::New(
    env, onBitmap, "rdp-bitmap", 0, 1);
  auto resizeTsFn = Napi::ThreadSafeFunction::New(
    env, onEvent, "rdp-resize", 0, 1);
  auto disconnectTsFn = Napi::ThreadSafeFunction::New(
    env, onEvent, "rdp-disconnect", 0, 1);
  auto errorTsFn = Napi::ThreadSafeFunction::New(
    env, onEvent, "rdp-error", 0, 1);

  auto listener = new JsFrameListener(
    std::move(bitmapTsFn), std::move(resizeTsFn),
    std::move(disconnectTsFn), std::move(errorTsFn));

  auto session = new RdpSession(
    host, port, width, height, username, password, listener);

  bool ok = session->connect();
  if (!ok) {
    delete session;
    delete listener;
    Napi::Error::New(env, "Failed to connect RDP session").ThrowAsJavaScriptException();
    return env.Null();
  }

  int id = nextId_++;
  {
    std::lock_guard<std::mutex> lock(sessionsMutex_);
    sessions_[id] = { session, listener };
  }

  return Napi::Number::New(env, id);
}

static Napi::Value DestroySession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected sessionId").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int id = info[0].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lock(sessionsMutex_);
  auto it = sessions_.find(id);
  if (it != sessions_.end()) {
    delete it->second.session;
    delete it->second.listener;
    sessions_.erase(it);
  }
  return env.Undefined();
}

static Napi::Value SendPointerEvent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4) {
    Napi::TypeError::New(env, "Expected 4 arguments").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int id = info[0].As<Napi::Number>().Int32Value();
  int flags = info[1].As<Napi::Number>().Int32Value();
  int x = info[2].As<Napi::Number>().Int32Value();
  int y = info[3].As<Napi::Number>().Int32Value();

  std::lock_guard<std::mutex> lock(sessionsMutex_);
  auto it = sessions_.find(id);
  if (it != sessions_.end()) {
    it->second.session->sendPointerEvent(flags, x, y);
  }
  return env.Undefined();
}

static Napi::Value SendKeyboardEvent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3) {
    Napi::TypeError::New(env, "Expected 3 arguments").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int id = info[0].As<Napi::Number>().Int32Value();
  int flags = info[1].As<Napi::Number>().Int32Value();
  int code = info[2].As<Napi::Number>().Int32Value();

  std::lock_guard<std::mutex> lock(sessionsMutex_);
  auto it = sessions_.find(id);
  if (it != sessions_.end()) {
    it->second.session->sendKeyboardEvent(flags, static_cast<UINT16>(code));
  }
  return env.Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createSession", Napi::Function::New(env, CreateSession));
  exports.Set("destroySession", Napi::Function::New(env, DestroySession));
  exports.Set("sendPointerEvent", Napi::Function::New(env, SendPointerEvent));
  exports.Set("sendKeyboardEvent", Napi::Function::New(env, SendKeyboardEvent));
  return exports;
}

NODE_API_MODULE(rdp_addon, Init)
