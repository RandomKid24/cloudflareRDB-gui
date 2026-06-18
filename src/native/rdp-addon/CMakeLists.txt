cmake_minimum_required(VERSION 3.20)
project(rdp_addon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ----- Find FreeRDP -----
find_package(FreeRDP CONFIG QUIET)
find_package(FreeRDP-Client CONFIG QUIET)
find_package(WinPR CONFIG QUIET)

if(TARGET FreeRDP::freerdp)
  message(STATUS "Found FreeRDP 3.x")
  set(FREERDP_TARGET FreeRDP::freerdp)
  set(FREERDP_CLIENT_TARGET FreeRDP::freerdp-client)
  set(WINPR_TARGET WinPR::winpr)
elseif(TARGET freerdp::freerdp2)
  message(STATUS "Found FreeRDP 2.x")
  set(FREERDP_TARGET freerdp::freerdp2)
  set(FREERDP_CLIENT_TARGET freerdp::freerdp-client2)
  set(WINPR_TARGET winpr::winpr2)
else()
  message(FATAL_ERROR
    "FreeRDP CMake config not found.\n"
    "Install via vcpkg: vcpkg install freerdp:x64-windows\n"
    "Then set -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake")
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
