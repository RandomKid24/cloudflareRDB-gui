cmake_minimum_required(VERSION 3.20)
project(rdp_addon LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# cmake-js provides N-API / Node.js include and link paths automatically

# ----- Find FreeRDP -----
find_package(freerdp CONFIG QUIET)
find_package(Freerdp CONFIG QUIET)
find_package(FreeRDP CONFIG QUIET)

if(TARGET freerdp::freerdp2)
  set(FREERDP_TARGET freerdp::freerdp2)
  set(FREERDP_CLIENT_TARGET freerdp::freerdp-client2)
  set(WINPR_TARGET winpr::winpr2)
elseif(TARGET Freerdp::Freerdp)
  set(FREERDP_TARGET Freerdp::Freerdp)
  set(FREERDP_CLIENT_TARGET Freerdp::FreerdpClient)
  set(WINPR_TARGET Freerdp::WinPR)
else()
  message(FATAL_ERROR
    "FreeRDP CMake config not found. Install via vcpkg:\n"
    "  vcpkg install freerdp:x64-windows\n"
    "Then set -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake")
endif()

message(STATUS "Found FreeRDP: ${FREERDP_TARGET}")

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

# cmake-js expects the output to be a .node file
# By default cmake-js renames the shared library to .node
set_target_properties(rdp_addon PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)
