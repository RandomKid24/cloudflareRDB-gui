vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO FreeRDP/FreeRDP
    REF "${VERSION}"
    SHA512 722d95d7591b5ce6a7e8a3b6ac8999df278dbcfc286a532f56bcbc4a3881e75b02c7e3cd4b296e67bc19d1165020acdcca198bf4bcc92aea5611760037fcc57f
    HEAD_REF master
    PATCHES
        DontInstallSystemRuntimeLibs.patch
        fix-include-path.patch
        fix-install-destination.patch
        keep-dup-libs.patch
        wfreerdp-server-cli.patch
        pr-7060-jni-onload.patch
        find-dependency.patch
        export-include.patch
)
file(REMOVE "${SOURCE_PATH}/cmake/FindOpenSSL.cmake")
file(WRITE "${SOURCE_PATH}/.source_version" "${VERSION}-vcpkg")

vcpkg_cmake_configure(
    SOURCE_PATH "${SOURCE_PATH}"
    OPTIONS
        -DWITH_CCACHE=OFF
        -DWITH_CLANG_FORMAT=OFF
        -DWITH_MANPAGES=OFF
        -DWITH_OPENSSL=ON
        -DWITH_KRB5=OFF
        "-DMSVC_RUNTIME=${VCPKG_CRT_LINKAGE}"
        -DPKG_CONFIG_USE_CMAKE_PREFIX_PATH=ON
        # Uncontrolled dependencies w.r.t. vcpkg ports
        -DWITH_ALSA=OFF
        -DWITH_CAIRO=OFF
    MAYBE_UNUSED_VARIABLES
        MSVC_RUNTIME
)

vcpkg_cmake_install()
vcpkg_copy_pdbs()
vcpkg_fixup_pkgconfig()

vcpkg_cmake_config_fixup(CONFIG_PATH lib/cmake/FreeRDP-Client2 PACKAGE_NAME freerdp-client2 DO_NOT_DELETE_PARENT_CONFIG_PATH)
vcpkg_cmake_config_fixup(CONFIG_PATH lib/cmake/WinPR2 PACKAGE_NAME winpr2 DO_NOT_DELETE_PARENT_CONFIG_PATH)
vcpkg_cmake_config_fixup(CONFIG_PATH lib/cmake/FreeRDP2 PACKAGE_NAME freerdp)

vcpkg_replace_string("${CURRENT_PACKAGES_DIR}/include/freerdp/build-config.h" "${CURRENT_BUILDTREES_DIR}/${TARGET_TRIPLET}-rel" ".")
vcpkg_replace_string("${CURRENT_PACKAGES_DIR}/include/freerdp/build-config.h" "${CURRENT_PACKAGES_DIR}/" "")
vcpkg_replace_string("${CURRENT_PACKAGES_DIR}/include/freerdp/build-config.h" "${CURRENT_PACKAGES_DIR}" "")

file(REMOVE_RECURSE
    "${CURRENT_PACKAGES_DIR}/debug/include"
    "${CURRENT_PACKAGES_DIR}/debug/share"
)

file(INSTALL "${SOURCE_PATH}/LICENSE" DESTINATION "${CURRENT_PACKAGES_DIR}/share/${PORT}" RENAME copyright)
