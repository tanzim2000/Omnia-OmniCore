# Licensing

How OmniCore is licensed, in plain words, and the exact terms that go with
it. The licence itself is in [LICENSE](LICENSE).

Copyright (C) 2026 Tanzim Ahmed

## In short

| What | Licence |
|---|---|
| **OmniCore**, the software in this repository | [GNU AGPL-3.0-only](LICENSE), with the permission and terms below |
| **Modules, faces and themes** ("Resources") | Whatever their author chooses. A Resource is its own work, not part of OmniCore (see below). |
| **The documentation** in `docs/` | All rights reserved. The code examples in it are [0BSD](#0bsd-for-the-code-examples). |
| **The names** Omnia, OmniCore and the others | Not licensed. See [TRADEMARKS.md](TRADEMARKS.md). |
| **The OmniCore Resource Registry** | CC BY 4.0, in its own repository |
| **Omnia Essentials**, the modules made by Tanzim Ahmed | 0BSD, in its own repository |

## OmniCore: the AGPL

You can use OmniCore, read its code, change it and share it. If you share
a changed version, or let other people use a changed version over a
network, you must offer them its source code under the same licence. That
keeps OmniCore and every version of it open.

From version 2.0.0, OmniCore is released under the GNU Affero General
Public License, version 3 only (SPDX: `AGPL-3.0-only`). Earlier releases
carried mixed licence statements (the LICENSE file said AGPL-3.0,
`package.json` said ISC and the README said MIT); this file covers 2.0.0
and later.

## Resources are their own works

A module, face or theme talks to OmniCore through its public interface:
the `omni` object a module is given, the data blocks a module hands back,
the theme contract, and the other interfaces described in `docs/`. That
doesn't make it part of OmniCore. Its author picks its licence: open or
closed, free or paid. When a Resource is listed in a registry without a
licence of its own, the registry's terms for its listings apply.

The exact wording, as an additional permission under section 7 of the
AGPL:

> **Additional permission under GNU AGPL version 3 section 7**
>
> A "Resource" is a module, face, theme or other add-on that OmniCore
> loads or runs and that works with OmniCore only through OmniCore's
> public interfaces, as documented in the `docs/` folder of OmniCore's
> source code (including the `omni` object given to modules, the data
> blocks modules return, and the theme contract).
>
> As a special exception, the copyright holder of OmniCore gives you
> permission to create, use, copy, modify, distribute and sell Resources
> under terms of your choice, including terms that are not free, and to
> run them with OmniCore, without those Resources being covered by the GNU
> Affero General Public License. Using OmniCore's public interfaces, and
> copying the names, data shapes and short code examples a Resource needs
> to use them, does not by itself make a Resource a work based on
> OmniCore.
>
> This exception does not apply to OmniCore itself or to modified versions
> of it. If you modify OmniCore, you may extend this exception to your
> version, but you are not obliged to. If you do not wish to, delete this
> exception from your version.

## Additional terms

Also under section 7 of the AGPL, these terms apply to OmniCore and to
every version based on it:

> **Additional terms under GNU AGPL version 3 section 7**
>
> 1. **Modified versions must be marked as different** (section 7(c)). If
>    you share a modified version of OmniCore, or let others use one over
>    a network, give it a name that is not OmniCore, Omnia or any other
>    name listed in TRADEMARKS.md, and say on its About page and in its
>    README that it is modified from OmniCore and is not the original.
> 2. **No rights to the names** (section 7(e)). This licence does not
>    grant any right to use the trade names, trademarks or logos of
>    OmniCore or the Omnia project, including those listed in
>    TRADEMARKS.md, except as TRADEMARKS.md allows.
> 3. **Keep the notices** (section 7(b)). Keep the copyright and licence
>    line shown on OmniCore's About page (the Appropriate Legal Notices) in
>    any version based on OmniCore.

## Other licences for companies

As the copyright holder, Tanzim Ahmed can also license OmniCore on other
terms, for example to a company that can't use AGPL software, or for a
modified edition of its own. To ask, get in touch through
[github.com/tanzim2000](https://github.com/tanzim2000).

## The documentation

The written documentation in the `docs/` folder (its Markdown files) is
Copyright (C) 2026 Tanzim Ahmed. All rights reserved. You may read it,
link to it, and quote short passages with credit. It is not covered by
the AGPL, and it may not be copied, republished or adapted without
permission.

The code examples in the documentation are the exception: they are under
0BSD, so you can copy them into your own module, face or theme with no
conditions at all.

## Contributing

Contributions are welcome under the [Contributor Licence Agreement](CLA.md).
It lets your contribution go into OmniCore under the AGPL and into any
other licence or edition of OmniCore, while you keep the copyright to
your work. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to agree to it.

## Libraries OmniCore uses

The libraries OmniCore is built on keep their own licences (MIT, ISC, BSD,
Apache-2.0, BlueOak-1.0.0 and the Unlicense). Each is in its folder in
`node_modules` once installed.

## 0BSD (for the code examples)

> Copyright (C) 2026 Tanzim Ahmed
>
> Permission to use, copy, modify, and/or distribute this software for
> any purpose with or without fee is hereby granted.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
> WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
> MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
> ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
> ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
> OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
