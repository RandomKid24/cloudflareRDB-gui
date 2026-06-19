cmake_minimum_required(VERSION 3.20)
project(rdp_addon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(FREERDP_ROOT "C:/vcpkg/installed/x64-windows")

find_path(FREERDP_INCLUDE_DIR freerdp/freerdp.h
  PATHS ${FREERDP_ROOT}/include
  NO_DEFAULT_PATH)

find_library(FREERDP_LIBRARY NAMES freerdp2 freerdp
  PATHS ${FREERDP_ROOT}/lib
  NO_DEFAULT_PATH)

find_library(FREERDP_CLIENT_LIBRARY NAMES freerdp-client2 freerdp-client
  PATHS ${FREERDP_ROOT}/lib
  NO_DEFAULT_PATH)

find_library(WINPR_LIBRARY NAMES winpr2 winpr
  PATHS ${FREERDP_ROOT}/lib
  NO_DEFAULT_PATH)

if(NOT FREERDP_INCLUDE_DIR OR NOT FREERDP_LIBRARY)
  message(FATAL_ERROR "FreeRDP headers/libs not found at ${FREERDP_ROOT}.\nInstall via vcpkg: vcpkg install freerdp:x64-windows")
endif()

message(STATUS "Found FreeRDP: ${FREERDP_INCLUDE_DIR}")

add_library(rdp_addon SHARED rdp_module.cpp rdp_session.cpp ${CMAKE_JS_SRC})
target_include_directories(rdp_addon PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_JS_INC} ${NAPI_DIR} ${FREERDP_INCLUDE_DIR})
target_link_libraries(rdp_addon PRIVATE ${FREERDP_LIBRARY} ${FREERDP_CLIENT_LIBRARY} ${WINPR_LIBRARY} ${CMAKE_JS_LIB})
set_target_properties(rdp_addon PROPERTIES PREFIX "" SUFFIX ".node")
