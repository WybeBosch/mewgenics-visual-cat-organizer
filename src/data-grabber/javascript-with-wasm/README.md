# get-the-data

This folder contains scripts and data files for extracting cat information from Mewgenics save files using JavaScript and WebAssembly.

## Pedigree Parsing Notes

- Parent pairs are parsed from pedigree triplets and ranked by confidence.
- Distinct two-parent matches are preferred over single-parent or stray sentinel matches.
- Ambiguous same-parent pairs (`X × X`) are treated as low-confidence and are not preferred over unknown parentage.

## How to Generate Cat Data

Use the web app to upload a save file and extract cat data directly in your browser using JavaScript and SQL WASM. No need to generate a local file; everything happens client-side.
