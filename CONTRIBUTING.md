# Contributing to OmniCore

Thanks for wanting to help. A few things to know first.

## Before your first pull request: the CLA

Every contribution from outside comes under the
[Contributor Licence Agreement](CLA.md). You keep the copyright to your
work; the agreement lets OmniCore use it under the AGPL and in other
editions of OmniCore under other licences (see [LICENSING.md](LICENSING.md)
for why).

To agree, post this comment on your first pull request:

> I have read the Contributor Licence Agreement (CLA.md) and I agree to it.

**Nothing from outside is merged until that comment is there.** You only
need to do it once.

If your job contract says your employer owns what you write, check with
them first (section 6 of the CLA).

## Making a change

- **Run the tests** before you send anything: `npm test`. Add tests for
  what you change.
- **Tabs** for indenting, everywhere except YAML files (which need spaces).
- **Comments a beginner can follow.** Say why something is done, not only
  what.
- **Write it down.** A change people will notice gets a line in
  `CHANGELOG.md`, under `## Unreleased`, in plain words.
- **No long dash** (the em dash) in anything a person reads: page text,
  module text, the CHANGELOG. Use a comma, a colon or a new sentence.
- **One change per pull request**, small enough to read in one sitting.

## Modules, faces and themes

You don't need to contribute here to make a module, face or theme. They
are their own works, under whatever licence you choose (see
[LICENSING.md](LICENSING.md)). Make it in your own repository and list it
in the OmniCore Resource Registry. Don't call it "official", and see
[TRADEMARKS.md](TRADEMARKS.md) for using the OmniCore name.

## The documentation

The written docs in `docs/` are all rights reserved, so they can't be
copied elsewhere, but fixes and improvements to them are welcome here,
under the same CLA.
