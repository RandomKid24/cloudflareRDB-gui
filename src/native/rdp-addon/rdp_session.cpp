#include "rdp_session.h"
#include <freerdp/settings.h>
#include <freerdp/version.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/input.h>
#include <winpr/wlog.h>

#ifdef _WIN32
#include <windows.h>
#include <openssl/provider.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

// Strip \\?\ prefix from Windows extended-length paths
static std::string normalizePath(const std::string& path) {
  if (path.size() >= 4 && path[0] == '\\' && path[1] == '\\' && path[2] == '?' && path[3] == '\\') {
    return path.substr(4);
  }
  return path;
}

static void fileLog(const char* msg) {
  FILE* f = fopen("C:\\Users\\Ady\\Desktop\\cloudflareRDB-gui\\addon-debug.log", "a");
  if (f) {
    fprintf(f, "%s\n", msg);
    fclose(f);
  }
}

static void logOpenSSLErrors() {
  unsigned long err;
  while ((err = ERR_get_error()) != 0) {
    char buf[256];
    ERR_error_string_n(err, buf, sizeof(buf));
    fileLog((std::string("OpenSSL error: ") + buf).c_str());
  }
}

// Global initializer that sets env vars at DLL load time.
// Uses _putenv_s so the shared CRT cache is updated for FreeRDP.
struct EnvVarInitializer {
  EnvVarInitializer() {
    HMODULE hMod = GetModuleHandleA("rdp_addon.node");
    if (!hMod) return;

    char dllPath[MAX_PATH];
    if (!GetModuleFileNameA(hMod, dllPath, MAX_PATH)) return;

    std::string dir(dllPath);
    auto pos = dir.find_last_of('\\');
    if (pos == std::string::npos) return;
    dir = normalizePath(dir.substr(0, pos));

    // _putenv_s updates BOTH the CRT cache AND the OS environment block.
    // Since we now use /MD (dynamic CRT), this shares the CRT cache with FreeRDP.
    _putenv_s("OPENSSL_MODULES", dir.c_str());

    // Also ensure openssl.cnf exists to auto-load legacy provider
    std::string cnfPath = dir + "\\openssl.cnf";
    WIN32_FIND_DATAA cnfFind;
    HANDLE hCnf = FindFirstFileA(cnfPath.c_str(), &cnfFind);
    if (hCnf == INVALID_HANDLE_VALUE) {
      FILE* f = fopen(cnfPath.c_str(), "w");
      if (f) {
        fprintf(f, "openssl_conf = openssl_init\n\n[openssl_init]\nproviders = provider_sect\n\n[provider_sect]\ndefault = default_sect\nlegacy = legacy_sect\n\n[default_sect]\nactivate = 1\n\n[legacy_sect]\nactivate = 1\n\n");
        fclose(f);
      }
    } else {
      FindClose(hCnf);
    }
    _putenv_s("OPENSSL_CONF", cnfPath.c_str());
  }
};
static EnvVarInitializer s_envInit;

static void ensureLegacyProvider() {
  HMODULE hMod = NULL;
  if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                              GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                          (LPCSTR)&ensureLegacyProvider, &hMod)) {
    return;
  }

  char dllPath[MAX_PATH];
  if (!GetModuleFileNameA(hMod, dllPath, MAX_PATH)) {
    return;
  }

  std::string dir(dllPath);
  auto pos = dir.find_last_of('\\');
  if (pos == std::string::npos) return;
  dir = normalizePath(dir.substr(0, pos));

  // Check OPENSSL_MODULES env var
  char* modulesDir = getenv("OPENSSL_MODULES");
  fileLog((std::string("ensureLegacyProvider: OPENSSL_MODULES=") + (modulesDir ? modulesDir : "NULL")).c_str());

  // Check OPENSSL_CONF env var
  char* confPath = getenv("OPENSSL_CONF");
  fileLog((std::string("ensureLegacyProvider: OPENSSL_CONF=") + (confPath ? confPath : "NULL")).c_str());

  // Load the legacy provider
  OSSL_PROVIDER* legacy = OSSL_PROVIDER_load(NULL, "legacy");
  if (legacy) {
    fileLog("ensureLegacyProvider: LEGACY loaded OK");
  } else {
    fileLog("ensureLegacyProvider: LEGACY FAILED");
    logOpenSSLErrors();
  }

  // Explicitly load default provider
  OSSL_PROVIDER* def = OSSL_PROVIDER_load(NULL, "default");
  if (def) {
    fileLog("ensureLegacyProvider: DEFAULT loaded OK");
  } else {
    fileLog("ensureLegacyProvider: DEFAULT FAILED");
    logOpenSSLErrors();
  }

  // Check which providers are loaded
  OSSL_PROVIDER* prov = OSSL_PROVIDER_load(NULL, "legacy");
  if (prov) {
    fileLog("ensureLegacyProvider: LEGACY (2nd attempt) loaded OK");
  } else {
    fileLog("ensureLegacyProvider: LEGACY (2nd attempt) FAILED");
    logOpenSSLErrors();
    ERR_clear_error();
  }

  // Now mimic EXACTLY what WinPR does in winpr_RC4_New_Internal
  const EVP_CIPHER* evp = EVP_rc4();
  fileLog((std::string("ensureLegacyProvider: EVP_rc4()=") + (evp ? "AVAILABLE" : "NULL")).c_str());

  if (evp) {
    // Step 1: EVP_CIPHER_CTX_new
    EVP_CIPHER_CTX* wctx = EVP_CIPHER_CTX_new();
    if (!wctx) {
      fileLog("ensureLegacyProvider: FAIL at EVP_CIPHER_CTX_new");
    } else {
      // Step 2: EVP_EncryptInit_ex with NULL key (just set cipher)
      EVP_CIPHER_CTX_reset(wctx);
      if (EVP_EncryptInit_ex(wctx, evp, NULL, NULL, NULL) != 1) {
        fileLog("ensureLegacyProvider: FAIL at EVP_EncryptInit_ex(NULL key)");
        logOpenSSLErrors();
      } else {
        fileLog("ensureLegacyProvider: EVP_EncryptInit_ex(NULL key) OK");
        // Step 3: Set FIPS flag
        EVP_CIPHER_CTX_set_flags(wctx, EVP_CIPH_FLAG_NON_FIPS_ALLOW);
        // Step 4: Set key length
        if (EVP_CIPHER_CTX_set_key_length(wctx, 16) != 1) {
          fileLog("ensureLegacyProvider: FAIL at EVP_CIPHER_CTX_set_key_length");
          logOpenSSLErrors();
        } else {
          fileLog("ensureLegacyProvider: EVP_CIPHER_CTX_set_key_length OK");
          // Step 5: Final EVP_EncryptInit_ex with actual key
          unsigned char testKey[16] = {0};
          if (EVP_EncryptInit_ex(wctx, NULL, NULL, testKey, NULL) != 1) {
            fileLog("ensureLegacyProvider: FAIL at EVP_EncryptInit_ex(key)");
            logOpenSSLErrors();
          } else {
            fileLog("ensureLegacyProvider: FULL WinPR RC4 INIT SEQUENCE OK");
          }
        }
      }
      EVP_CIPHER_CTX_free(wctx);
    }
  } else {
    // Try loading with explicit module path
    fileLog("ensureLegacyProvider: Trying OSSL_PROVIDER_load with path...");
    OSSL_PROVIDER* prov_path = OSSL_PROVIDER_load(NULL, (dir + "\\legacy.dll").c_str());
    if (prov_path) {
      fileLog("ensureLegacyProvider: LEGACY loaded via path OK");
    } else {
      fileLog("ensureLegacyProvider: LEGACY via path FAILED");
      logOpenSSLErrors();
    }
  }
}
#endif

static DWORD verifyCertificateCallback(freerdp* instance, const char* common_name,
                                       const char* subject, const char* issuer,
                                       const char* fingerprint, BOOL host_mismatch) {
  const char* host = freerdp_settings_get_string(instance->context->settings, FreeRDP_ServerHostname);
  if (host && (strcmp(host, "127.0.0.1") == 0 || strcmp(host, "localhost") == 0)) {
    fprintf(stderr, "[RDP] verifyCertificateCallback: Accepting loopback cert for %s\n", host);
    fflush(stderr);
    return 1; // Trust loopback certificate
  }
  fprintf(stderr, "[RDP] verifyCertificateCallback: Rejecting non-loopback cert for %s\n", host ? host : "(null)");
  fflush(stderr);
  return 0; // Reject others
}

static DWORD verifyChangedCertificateCallback(freerdp* instance, const char* common_name,
                                              const char* subject, const char* issuer,
                                              const char* fingerprint, const char* old_subject,
                                              const char* old_issuer, const char* old_fingerprint) {
  const char* host = freerdp_settings_get_string(instance->context->settings, FreeRDP_ServerHostname);
  if (host && (strcmp(host, "127.0.0.1") == 0 || strcmp(host, "localhost") == 0)) {
    fprintf(stderr, "[RDP] verifyChangedCertificateCallback: Accepting changed loopback cert for %s\n", host);
    fflush(stderr);
    return 1; // Trust changed loopback certificate
  }
  fprintf(stderr, "[RDP] verifyChangedCertificateCallback: Rejecting changed non-loopback cert for %s\n", host ? host : "(null)");
  fflush(stderr);
  return 0; // Reject others
}

struct RdpSessionContext {
  rdpContext _ctx;
  RdpSession* session;
};

RdpSession::RdpSession(const std::string& host, int port,
                       int width, int height,
                       const std::string& username,
                       const std::string& password,
                       RdpFrameListener* listener,
                       const std::string& serverHostname)
  : host_(host), port_(port), width_(width), height_(height),
    username_(username), password_(password), listener_(listener),
    serverHostname_(serverHostname.empty() ? host : serverHostname) {}

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
#ifdef _WIN32
  ensureLegacyProvider();
#endif
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
#if defined(FREERDP_VERSION_MAJOR) && FREERDP_VERSION_MAJOR >= 3
  freerdp_settings_set_string(settings, FreeRDP_UserSpecifiedServerName, serverHostname_.c_str());
#else
  freerdp_settings_set_string(settings, FreeRDP_ServerHostname, serverHostname_.c_str());
#endif
  freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, port_);
  freerdp_settings_set_uint32(settings, FreeRDP_DesktopWidth, width_);
  freerdp_settings_set_uint32(settings, FreeRDP_DesktopHeight, height_);
  freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32);

  if (username_.empty()) {
    fprintf(stderr, "[RDP] ERROR: no username provided, cannot authenticate\n");
    lastError_ = "No username provided for RDP authentication";
    if (listener_) listener_->onError(lastError_.c_str());
    freerdp_context_free(instance_);
    freerdp_free(instance_);
    instance_ = nullptr;
    context_ = nullptr;
    return false;
  }

  std::string normUsername = username_;
  for (char& c : normUsername) {
    if (c == '/') {
      c = '\\';
    }
  }

  freerdp_settings_set_string(settings, FreeRDP_Username, normUsername.c_str());
  freerdp_settings_set_string(settings, FreeRDP_Password, password_.c_str());

  {
    char* parsedUser = nullptr;
    char* parsedDomain = nullptr;
    if (freerdp_parse_username(normUsername.c_str(), &parsedUser, &parsedDomain)) {
      if (parsedUser) {
        freerdp_settings_set_string(settings, FreeRDP_Username, parsedUser);
      }
      if (parsedDomain && strlen(parsedDomain) > 0) {
        freerdp_settings_set_string(settings, FreeRDP_Domain, parsedDomain);
      } else {
        freerdp_settings_set_string(settings, FreeRDP_Domain, "");
      }
      fprintf(stderr, "[RDP] parsed domain='%s' user='%s' from username='%s'\n",
              parsedDomain ? parsedDomain : "", parsedUser ? parsedUser : "", normUsername.c_str());
      free(parsedUser);
      free(parsedDomain);
    } else {
      freerdp_settings_set_string(settings, FreeRDP_Domain, "");
    }
    fprintf(stderr, "[RDP] credentials: username='%s' domain='%s' password_len=%zu\n",
            freerdp_settings_get_string(settings, FreeRDP_Username),
            freerdp_settings_get_string(settings, FreeRDP_Domain) ? freerdp_settings_get_string(settings, FreeRDP_Domain) : "",
            password_.length());
    fflush(stderr);
  }

  // Security: offer TLS and NLA, let server choose. Server requires HYBRID.
  freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_TlsSecurity, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_RdpSecurity, TRUE);

  // Set TLS security level to 1 (instead of OpenSSL 3.x default of 2).
  // This allows connecting to servers with self-signed certificates or smaller key sizes (e.g. 1024-bit).
  freerdp_settings_set_uint32(settings, FreeRDP_TlsSecLevel, 1);

  // Keep ignoring cert since we're going over a loopback tunnel
  freerdp_settings_set_bool(settings, FreeRDP_IgnoreCertificate, TRUE);

  freerdp_settings_set_bool(settings, FreeRDP_Authentication, TRUE);

  freerdp_settings_set_bool(settings, FreeRDP_NSCodec, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_RemoteFxCodec, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_FastPathOutput, TRUE);

  instance_->VerifyCertificate = verifyCertificateCallback;
  instance_->VerifyChangedCertificate = verifyChangedCertificateCallback;
  instance_->PostConnect = postConnectCallback;

  WLog_SetLogLevel(WLog_Get("com.freerdp.core.tls"), WLOG_TRACE);
  WLog_SetLogLevel(WLog_Get("com.freerdp.core.nego"), WLOG_TRACE);
  WLog_SetLogLevel(WLog_Get("com.freerdp.core.transport"), WLOG_TRACE);
  WLog_SetLogLevel(WLog_Get("com.freerdp.core.nla"), WLOG_TRACE);
  WLog_SetLogLevel(WLog_Get("com.freerdp.core.credssp"), WLOG_TRACE);
  WLog_SetLogLevel(WLog_Get("com.winpr.sspi"), WLOG_TRACE);
  WLog_SetLogLevel(WLog_GetRoot(), WLOG_TRACE);

  const char* actualHost = freerdp_settings_get_string(settings, FreeRDP_ServerHostname);
  UINT32 actualPort = freerdp_settings_get_uint32(settings, FreeRDP_ServerPort);
  fprintf(stderr, "[RDP] AUTH_TUPLE: host='%s', port=%u, username='%s', domain='%s', password_len=%zu, IgnoreCertificate=%d, NlaSecurity=%d, TlsSecurity=%d\n",
          actualHost ? actualHost : "(null)",
          actualPort,
          freerdp_settings_get_string(settings, FreeRDP_Username) ? freerdp_settings_get_string(settings, FreeRDP_Username) : "(null)",
          freerdp_settings_get_string(settings, FreeRDP_Domain) ? freerdp_settings_get_string(settings, FreeRDP_Domain) : "(null)",
          password_.length(),
          freerdp_settings_get_bool(settings, FreeRDP_IgnoreCertificate) ? 1 : 0,
          freerdp_settings_get_bool(settings, FreeRDP_NlaSecurity) ? 1 : 0,
          freerdp_settings_get_bool(settings, FreeRDP_TlsSecurity) ? 1 : 0);
  fflush(stderr);

  BOOL connectResult = freerdp_connect(instance_);
  if (connectResult != TRUE) {
    UINT32 lastError = freerdp_get_last_error(context_);
    const char* errorStr = freerdp_get_last_error_string(lastError);
    char buf[256];
    if (errorStr) {
      snprintf(buf, sizeof(buf), "freerdp_connect failed: code=%u (%s) [host='%s' port=%u]",
               lastError, errorStr,
               actualHost ? actualHost : "null", actualPort);
    } else {
      snprintf(buf, sizeof(buf), "freerdp_connect failed: code=%u [host='%s' port=%u]",
               lastError,
               actualHost ? actualHost : "null", actualPort);
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

