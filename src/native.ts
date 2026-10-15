// SPDX-License-Identifier: GPL-3.0-or-later

import { CspPolicies, ImageSrc } from "@main/csp";
import { RendererSettings } from "@main/settings";

const defaultEndpoint = "https://catgifs.marni.cc/api/gifs";
const apiEndpoint = RendererSettings.store.plugins.CatGIFs?.apiEndpoint ?? defaultEndpoint;

CspPolicies["catgifs.marni.cc"] = ImageSrc;

if (URL.canParse(apiEndpoint)) {
    const { host, protocol } = new URL(apiEndpoint);
    if (protocol === "https:" || protocol === "http:") CspPolicies[host] = ImageSrc;
}
