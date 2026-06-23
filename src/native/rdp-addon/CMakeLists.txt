cmake_minimum_required(VERSION 3.20)
project(rdp_addon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# FREERDP_ROOT is set via -D from build-native.js per platform:
#   Windows: C:/vcpkg/installed/x64-windows
#   macOS:   $(brew --prefix freerdp)
#   Linux:   /usr
# If unset, cmake searches system paths.

find_path(FREERDP_INCLUDE_DIR freerdp/freerdp.h
  HINTS ${FREERDP_ROOT}
  PATH_SUFFIXES include include/freerdp2 include/freerdp3)

find_path(WINPR_INCLUDE_DIR winpr/winpr.h
  HINTS ${FREERDP_ROOT}
  PATH_SUFFIXES include include/winpr2 include/winpr3)

find_library(FREERDP_LIBRARY NAMES freerdp3 freerdp2 freerdp
  HINTS ${FREERDP_ROOT}
  PATH_SUFFIXES lib)

find_library(FREERDP_CLIENT_LIBRARY NAMES freerdp-client3 freerdp-client2 freerdp-client
  HINTS ${FREERDP_ROOT}
  PATH_SUFFIXES lib)

find_library(WINPR_LIBRARY NAMES winpr3 winpr2 winpr
  HINTS ${FREERDP_ROOT}
  PATH_SUFFIXES lib)

find_library(LIBCRYPTO_LIBRARY NAMES crypto libcrypto
  HINTS ${FREERDP_ROOT}
  PATH_SUFFIXES lib)

find_path(OPENSSL_INCLUDE_DIR openssl/provider.h
  HINTS ${FREERDP_ROOT}
  PATH_SUFFIXES include)

message(STATUS "Found libcrypto: ${LIBCRYPTO_LIBRARY}")
message(STATUS "OpenSSL include: ${OPENSSL_INCLUDE_DIR}")

if(NOT FREERDP_INCLUDE_DIR OR NOT FREERDP_LIBRARY)
  message(FATAL_ERROR "FreeRDP headers/libs not found. Install freerdp via your package manager:\n"
    "  Windows: vcpkg install freerdp:x64-windows\n"
    "  macOS:   brew install freerdp\n"
    "  Linux:   sudo apt-get install freerdp2-dev")
endif()

message(STATUS "Found FreeRDP: ${FREERDP_INCLUDE_DIR}")
message(STATUS "Found WINPR: ${WINPR_INCLUDE_DIR}")

add_library(rdp_addon SHARED rdp_module.cpp rdp_session.cpp ${CMAKE_JS_SRC})
target_include_directories(rdp_addon PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_JS_INC} ${NAPI_DIR} ${FREERDP_INCLUDE_DIR} ${WINPR_INCLUDE_DIR} ${OPENSSL_INCLUDE_DIR})
target_link_libraries(rdp_addon PRIVATE ${FREERDP_LIBRARY} ${FREERDP_CLIENT_LIBRARY} ${WINPR_LIBRARY} ${LIBCRYPTO_LIBRARY} ${CMAKE_JS_LIB})
set_target_properties(rdp_addon PROPERTIES PREFIX "" SUFFIX ".node")
