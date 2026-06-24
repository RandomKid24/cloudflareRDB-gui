#include "rdp_session.h"
#include <freerdp/settings.h>
#include <freerdp/version.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/input.h>
#include <winpr/wlog.h>
#include <winpr/sspi.h>
#include <thread>
#include <chrono>
#include <mutex>
static std::mutex s_logMutex;

static void fileLog(const char* msg) {
#ifdef _WIN32
  std::lock_guard<std::mutex> lock(s_logMutex);
  FILE* f = fopen("C:\\Users\\Ady\\Desktop\\cloudflareRDB-gui\\addon-debug.log", "a");
  if (f) {
    fprintf(f, "%s\n", msg);
    fclose(f);
  }
#else
  fprintf(stderr, "%s\n", msg);
  fflush(stderr);
#endif
}

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
    fileLog((std::string("[RDP] verifyCertificateCallback: Accepting loopback cert for ") + host).c_str());
    return 1; // Trust loopback certificate
  }
  fileLog((std::string("[RDP] verifyCertificateCallback: Rejecting non-loopback cert for ") + (host ? host : "(null)")).c_str());
  return 0; // Reject others
}

static DWORD verifyChangedCertificateCallback(freerdp* instance, const char* common_name,
                                              const char* subject, const char* issuer,
                                              const char* fingerprint, const char* old_subject,
                                              const char* old_issuer, const char* old_fingerprint) {
  const char* host = freerdp_settings_get_string(instance->context->settings, FreeRDP_ServerHostname);
  if (host && (strcmp(host, "127.0.0.1") == 0 || strcmp(host, "localhost") == 0)) {
    fileLog((std::string("[RDP] verifyChangedCertificateCallback: Accepting changed loopback cert for ") + host).c_str());
    return 1; // Trust changed loopback certificate
  }
  fileLog((std::string("[RDP] verifyChangedCertificateCallback: Rejecting changed non-loopback cert for ") + (host ? host : "(null)")).c_str());
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
  fileLog("[RDP] postConnectCallback entered");
  RdpSession* self = getSelf(instance->context);
  if (!self) {
    fileLog("[RDP] postConnectCallback: self is null!");
    return FALSE;
  }

  fileLog(("[RDP] postConnect called, gdi pointer: " + std::to_string((uintptr_t)instance->context->gdi)).c_str());

  fileLog("[RDP] calling gdi_init...");
  BOOL gdiInitResult = gdi_init(instance, PIXEL_FORMAT_BGRX32);
  fileLog(("[RDP] gdi_init result: " + std::to_string(gdiInitResult)).c_str());

  if (gdiInitResult != TRUE) {
    self->lastError_ = "gdi_init failed in PostConnect";
    if (self->listener_) self->listener_->onError(self->lastError_.c_str());
    return FALSE;
  }

  fileLog(("[RDP] gdi_init OK, primary_buffer pointer: " + std::to_string((uintptr_t)instance->context->gdi->primary_buffer)).c_str());

  fileLog(("[RDP] registering callbacks via context_->update: " + std::to_string((uintptr_t)self->context_->update)).c_str());
  self->context_->update->BeginPaint = beginPaint;
  self->context_->update->EndPaint = endPaint;
  self->context_->update->DesktopResize = desktopResize;
  fileLog(("[RDP] callbacks set: EndPaint=" + std::to_string((uintptr_t)self->context_->update->EndPaint) + ", DesktopResize=" + std::to_string((uintptr_t)self->context_->update->DesktopResize)).c_str());

  fileLog("[RDP] postConnectCallback exiting with TRUE");
  return TRUE;
}

bool RdpSession::connect() {
#ifdef _WIN32
  ensureLegacyProvider();
#endif

  // FreeRDP 3.x: sspi_GlobalInit() must be called once before any SSPI operation.
  // It populates NEGOTIATE_SecPkgInfoW_NameBuffer (and similar buffers) via
  // InitializeConstWCharFromUtf8. Without this, QuerySecurityPackageInfo("Negotiate")
  // does _wcscmp(L"Negotiate", L"") and returns SEC_E_SECPKG_NOT_FOUND, which
  // manifests as the "packageName=N" / ERRCONNECT_AUTHENTICATION_FAILED error.
  // This call is idempotent — safe to call multiple times.
  sspi_GlobalInit();
  fileLog("[RDP] sspi_GlobalInit() called successfully");
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
  // UserSpecifiedServerName is set to the REAL hostname (not 127.0.0.1) so that
  // FreeRDP's NLA/SSPI can generate a valid SPN for authentication. ServerHostname
  // stays as 127.0.0.1 so the TCP connection goes through the cloudflared tunnel.
  // FreeRDP 3.x uses UserSpecifiedServerName ONLY for SPN/title, not for TCP resolution
  // when ServerHostname is explicitly set.
#if defined(FREERDP_VERSION_MAJOR) && FREERDP_VERSION_MAJOR >= 3
  freerdp_settings_set_string(settings, FreeRDP_UserSpecifiedServerName, serverHostname_.c_str());
#else
  freerdp_settings_set_string(settings, FreeRDP_ServerHostname, host_.c_str());
#endif
  freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, port_);
  freerdp_settings_set_uint32(settings, FreeRDP_DesktopWidth, width_);
  freerdp_settings_set_uint32(settings, FreeRDP_DesktopHeight, height_);
  freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32);

  if (username_.empty()) {
    fileLog("[RDP] ERROR: no username provided, cannot authenticate");
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
      fileLog((std::string("[RDP] parsed domain='") + (parsedDomain ? parsedDomain : "") + "' user='" + (parsedUser ? parsedUser : "") + "' from username='" + normUsername + "'").c_str());
      free(parsedUser);
      free(parsedDomain);
    } else {
      freerdp_settings_set_string(settings, FreeRDP_Domain, "");
    }
    fileLog((std::string("[RDP] credentials: username='") + (freerdp_settings_get_string(settings, FreeRDP_Username) ? freerdp_settings_get_string(settings, FreeRDP_Username) : "") + "' domain='" + (freerdp_settings_get_string(settings, FreeRDP_Domain) ? freerdp_settings_get_string(settings, FreeRDP_Domain) : "") + "' password_len=" + std::to_string(password_.length())).c_str());
  }

  // Security: enable NLA + TLS + RDP on all platforms.
  // NLA was previously disabled on Windows to work around SSPI loopback blocks,
  // but sspi_GlobalInit() + WITH_NATIVE_SSPI=OFF fully resolves that.
  // NLA must be TRUE — server rejects with HYBRID_REQUIRED_BY_SERVER without it.
  freerdp_settings_set_bool(settings, FreeRDP_TlsSecurity, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_RdpSecurity, TRUE);
  freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, TRUE);

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
  fileLog((std::string("[RDP] AUTH_TUPLE: host='") + (actualHost ? actualHost : "null") +
           "', port=" + std::to_string(actualPort) +
           ", username='" + (freerdp_settings_get_string(settings, FreeRDP_Username) ? freerdp_settings_get_string(settings, FreeRDP_Username) : "null") +
           "', domain='" + (freerdp_settings_get_string(settings, FreeRDP_Domain) ? freerdp_settings_get_string(settings, FreeRDP_Domain) : "null") +
           "', password_len=" + std::to_string(password_.length()) +
           ", IgnoreCertificate=" + std::to_string(freerdp_settings_get_bool(settings, FreeRDP_IgnoreCertificate) ? 1 : 0) +
           ", NlaSecurity=" + std::to_string(freerdp_settings_get_bool(settings, FreeRDP_NlaSecurity) ? 1 : 0) +
           ", TlsSecurity=" + std::to_string(freerdp_settings_get_bool(settings, FreeRDP_TlsSecurity) ? 1 : 0)).c_str());

  fileLog("[RDP] RdpSession::connect: calling freerdp_connect");
  BOOL connectResult = freerdp_connect(instance_);
  fileLog(("[RDP] RdpSession::connect: freerdp_connect returned " + std::to_string(connectResult)).c_str());
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
    fileLog((std::string("[RDP] RdpSession::connect failed error: ") + lastError_).c_str());
    if (listener_) listener_->onError(lastError_.c_str());
    freerdp_context_free(instance_);
    freerdp_free(instance_);
    instance_ = nullptr;
    context_ = nullptr;
    return false;
  }

  fileLog("[RDP] RdpSession::connect: successful connection, starting pump thread");
  connected_ = true;
  running_ = true;

  updateThread_ = new std::thread(&RdpSession::pump, this);
  fileLog("[RDP] RdpSession::connect exiting with true");

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
  fileLog("[RDP] pump started");
  int consecutiveFailures = 0;
  while (running_ && connected_) {
    HANDLE handles[64];
    DWORD ncount = freerdp_get_event_handles(context_, handles, 64);
    if (ncount == 0) {
      fileLog("[RDP] pump: no event handles");
#ifdef _WIN32
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
#endif
      continue;
    }

    if (!freerdp_check_event_handles(context_)) {
      int shall = freerdp_shall_disconnect_context(context_);
      UINT32 err = freerdp_get_last_error(context_);
      const char* errStr = freerdp_get_last_error_string(err);
      fileLog((std::string("[RDP] pump: check_event_handles failed, shall_disconnect=") + std::to_string(shall) + ", last_error=" + std::to_string(err) + " (" + (errStr ? errStr : "unknown") + ")").c_str());

      if (shall) {
        if (listener_) listener_->onDisconnect("RDP server disconnected");
        connected_ = false;
        break;
      }

      consecutiveFailures++;
      if (consecutiveFailures > 50) {
        fileLog("[RDP] pump: too many consecutive failures, forcing disconnect");
        if (listener_) listener_->onDisconnect("RDP pump stalled");
        connected_ = false;
        break;
      }
    } else {
      consecutiveFailures = 0;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  fileLog("[RDP] pump exited");
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
  fileLog("[RDP] beginPaint called");
  return TRUE;
}

BOOL RdpSession::endPaint(rdpContext* ctx) {
  fileLog("[RDP] endPaint called");

  RdpSession* self = getSelf(ctx);
  if (!self || !self->listener_) {
    fileLog("[RDP] endPaint: no self or listener");
    return TRUE;
  }

  rdpGdi* gdi = ctx->gdi;
  if (!gdi || !gdi->primary_buffer) {
    fileLog("[RDP] endPaint: no gdi or buffer");
    return TRUE;
  }

  // Guard the full pointer chain before any dereference.
  // In headless/addon mode, primary, hdc, hwnd, or invalid can be null
  // during connection negotiation or after a resolution change.
  if (!gdi->primary || !gdi->primary->hdc ||
      !gdi->primary->hdc->hwnd || !gdi->primary->hdc->hwnd->invalid) {
    fileLog("[RDP] endPaint: GDI sub-structure not ready, skipping");
    return TRUE;
  }

  HGDI_WND wnd = gdi->primary->hdc->hwnd;
  fileLog(("[RDP] endPaint: invalid->null=" + std::to_string(wnd->invalid->null)).c_str());

  if (wnd->invalid->null)
    return TRUE;

  INT32 x = wnd->invalid->x;
  INT32 y = wnd->invalid->y;
  INT32 w = wnd->invalid->w;
  INT32 h = wnd->invalid->h;

  fileLog(("[RDP] endPaint dirty region: x=" + std::to_string(x) + ", y=" + std::to_string(y) + ", w=" + std::to_string(w) + ", h=" + std::to_string(h)).c_str());

  // Clamp negative origins into the valid buffer region.
  // Malformed server updates can send negative x/y.
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }

  // Clamp extents against the actual GDI surface dimensions.
  if (x + w > (INT32)gdi->width)  w = (INT32)gdi->width  - x;
  if (y + h > (INT32)gdi->height) h = (INT32)gdi->height - y;

  if (w <= 0 || h <= 0) {
    wnd->invalid->null = TRUE;
    return TRUE;
  }

  int stride = gdi->stride;  // Use gdi->stride — may include alignment padding
  int bpp = 4;

  const BYTE* src = gdi->primary_buffer;
  std::vector<uint8_t> rgba(w * h * bpp);

  for (int row = 0; row < h; row++) {
    const BYTE* srcRow = src + (y + row) * stride + x * bpp;
    uint8_t* dstRow = rgba.data() + row * w * bpp;
    for (int col = 0; col < w; col++) {
      dstRow[col * 4 + 0] = srcRow[col * 4 + 2];  // R ← B (BGRX→RGBA)
      dstRow[col * 4 + 1] = srcRow[col * 4 + 1];  // G ← G
      dstRow[col * 4 + 2] = srcRow[col * 4 + 0];  // B ← R
      dstRow[col * 4 + 3] = 255;
    }
  }

  fileLog("[RDP] endPaint calling onBitmapUpdate listener callback");
  self->listener_->onBitmapUpdate(x, y, w, h, rgba.data(), rgba.size());
  fileLog("[RDP] endPaint callback successfully sent frame");

  wnd->invalid->null = TRUE;
  wnd->ninvalid = 0;

  return TRUE;
}

BOOL RdpSession::desktopResize(rdpContext* ctx) {
  fileLog("[RDP] desktopResize called");

  RdpSession* self = getSelf(ctx);
  if (!self) {
    fileLog("[RDP] desktopResize: self is null");
    return FALSE;
  }

  rdpSettings* settings = ctx->settings;
  UINT32 newW = freerdp_settings_get_uint32(settings, FreeRDP_DesktopWidth);
  UINT32 newH = freerdp_settings_get_uint32(settings, FreeRDP_DesktopHeight);
  fileLog(("[RDP] desktopResize: new size = " + std::to_string(newW) + "x" + std::to_string(newH)).c_str());

  if (newW == 0 || newH == 0) {
    fileLog("[RDP] desktopResize: invalid dimensions, skipping");
    return FALSE;
  }

  // Resize the GDI framebuffer to match the new remote resolution.
  // Without this, the old buffer remains at the old size and subsequent
  // endPaint calls with the new coordinates overflow into unmapped memory.
  // NOTE: gdi_resize() reallocates primary_buffer — do NOT use any pointer
  // cached before this call after it returns.
  rdpGdi* gdi = ctx->gdi;
  if (gdi) {
    fileLog("[RDP] calling gdi_resize...");
    if (!gdi_resize(gdi, newW, newH)) {
      fileLog("[RDP] desktopResize: gdi_resize failed");
      return FALSE;
    }
    fileLog(("[RDP] desktopResize: gdi_resize OK, new primary_buffer=" + std::to_string((uintptr_t)gdi->primary_buffer)).c_str());
  } else {
    fileLog("[RDP] desktopResize: gdi is null, skipping resize");
  }

  self->width_  = (int)newW;
  self->height_ = (int)newH;

  if (self->listener_) {
    fileLog("[RDP] calling onResize listener callback");
    self->listener_->onResize((int)newW, (int)newH);
    fileLog("[RDP] onResize callback successful");
  }

  return TRUE;
}

