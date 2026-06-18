cmake_minimum_required(VERSION 3.20)
project(rdp_addon LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ----- Find FreeRDP (try 3.x package names, then 2.x fallbacks) -----
find_package(FreeRDP3 CONFIG QUIET)
find_package(FreeRDP-Client3 CONFIG QUIET)
find_package(WinPR3 CONFIG QUIET)

if(TARGET freerdp)
  message(STATUS "Found FreeRDP 3.x: freerdp, freerdp-client, winpr")
  set(FREERDP_TARGET freerdp)
  set(FREERDP_CLIENT_TARGET freerdp-client)
  set(WINPR_TARGET winpr)
else()
  # FreeRDP 2.x fallback
  find_package(freerdp CONFIG QUIET)
  find_package(Freerdp CONFIG QUIET)

  if(TARGET freerdp::freerdp2)
    message(STATUS "Found FreeRDP 2.x: freerdp::freerdp2")
    set(FREERDP_TARGET freerdp::freerdp2)
    set(FREERDP_CLIENT_TARGET freerdp::freerdp-client2)
    set(WINPR_TARGET winpr::winpr2)
  elseif(TARGET Freerdp::Freerdp)
    message(STATUS "Found FreeRDP 2.x: Freerdp::Freerdp")
    set(FREERDP_TARGET Freerdp::Freerdp)
    set(FREERDP_CLIENT_TARGET Freerdp::FreerdpClient)
    set(WINPR_TARGET Freerdp::WinPR)
  else()
    message(FATAL_ERROR
      "FreeRDP CMake config not found. Tried: FreeRDP3, FreeRDP-Client3, WinPR3, freerdp, Freerdp\n"
      "Install via vcpkg: vcpkg install freerdp:x64-windows\n"
      "Then set -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake")
  endif()
endif()

# ----- Addon library -----
add_library(rdp_addon SHARED
  rdp_module.cpp
  rdp_session.cpp
)

target_include_directories(rdp_addon PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(rdp_addon PRIVATE
  ${FREERDP_TARGET}
  ${FREERDP_CLIENT_TARGET}
  ${WINPR_TARGET}
)

set_target_properties(rdp_addon PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)
