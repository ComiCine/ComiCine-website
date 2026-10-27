// Copyright (C) 2026-Present ComiCine
// SPDX-License-Identifier: AGPL-3.0-or-later
// Section 7 additional terms apply when the work is used under GNU AGPL v3.
// See ADDITIONAL_TERMS.txt.

// Forward the public Pages alias to the canonical custom domain.
export default {
	fetch(request) {
		const destination = new URL(request.url);
		destination.protocol = "https:";
		destination.hostname = "comicine.com";
		destination.port = "";
		return Response.redirect(destination.toString(), 308);
	},
};
