## 6.1.0

- Add support for importing Feybound: every chapter becomes a journal (sidebars, ancestries, archetypes, creature
  stat blocks and the First World gazetteer included), plus the book's illustrations and the Yestereve Revels map
- Detect Feybound before other adventures, as some detectors match common words that appear in its text

## 5.0.0

- Update to v12
- Fix some issues with images not being saved correctly (fixes #16 and #14)
- Update to use the new Compendium Art system in FVTT v12 instead of the PF2E system
- Remove settings for setting compendium art. This is now handled by the Compendium Art system
- Prevent placeholder art from being used as the art in the compendiums
- Add support for token backgrounds to meet parity with the premium art module
- Add button to preset token art to use the premium bestiary art module if you've purchased it
- Load first scene in the world when import is complete
- Move all scene data to separate json files and update the scenes to use the new format
- Improve error messages so I hopefully don't get as many bug reports for things that aren't supported
- Add CORS flag to token art images to hopefully allow externally hosted images to be used (fixes #11)
- Remove resize maps option
- Remove support for compendium art upgrading from pre-4.0.0 versions (i.e. don't go directly from v10 to v12)
- Bump versions of all dependencies

## 4.1.2

- Fix token art database not working in 4.1.1.
- Work around issue when other installed modules break the array prototype by adding methods to it
- Fix issue with actors in PFS 2-04
- Major refactor of code, including automated tests in FVTT (using playwright)

## 4.1.1

- Bugfix for tokens that are auto-matically placed not being editable (regression in FVTT v11)
- Bugfix for tokens not being created with default setting (regression in FVTT v11)
- Bugfix for token art not being generated at all (regression in 4.1.0)
- Moved build platform to Vite

## 4.1.0

- Update to v11 (mainly a manifest bump)
- Fix issue with bad images from gamemastery guide import
- Add PFS 3-12 and 3-13
- Fix a few monsters in Bestiary 3 not importing correctly
- Add an option to use art mapping from other modules if it exists, such as the PF2E token pack (defaults to this behavior)
- Fix bug when the "Create Data Entry Actors" option was enabled
- Fix version checking algorithm
- Fix issue in Night of the Gray Death causing a map to not be imported
- Super minor fix in Sundered Waves
- Remove opt-in telemetry since there's paid modules now
- Moved to github (https://github.com/fryguy1013/pdftofoundry)
- Lots of minor technical debt fixes