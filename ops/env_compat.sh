#!/usr/bin/env bash

# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# The canonical operational variables use COMICINE_. Mirror their former LIMOOO_
# names in both directions so local scripts, hooks, and existing CI callers keep working.
comicine_import_env_aliases() {
    local legacy canonical

    for legacy in ${!LIMOOO_@}; do
        canonical="COMICINE_${legacy#LIMOOO_}"
        if [[ ${!canonical+x} == x ]]; then
            printf -v "$legacy" '%s' "${!canonical}"
            export "$legacy"
        else
            printf -v "$canonical" '%s' "${!legacy}"
            export "$canonical"
        fi
    done

    for canonical in ${!COMICINE_@}; do
        legacy="LIMOOO_${canonical#COMICINE_}"
        if [[ ${!legacy+x} != x ]]; then
            printf -v "$legacy" '%s' "${!canonical}"
            export "$legacy"
        fi
    done
}

comicine_import_env_aliases
unset -f comicine_import_env_aliases
