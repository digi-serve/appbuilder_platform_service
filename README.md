# appbuilder_platform_service
[![GitHub Workflow Status (with event)](https://img.shields.io/github/actions/workflow/status/digi-serve/appbuilder_platform_service/pr-merge-release.yml?logo=github&label=Build%20%26%20Test)](https://github.com/digi-serve/ab_service_relay/actions/appbuilder_platform_service/pr-merge-release.yml)
[![GitHub tag (with filter)](https://img.shields.io/github/v/tag/digi-serve/appbuilder_platform_service?logo=github&label=Latest%20Version)
](https://github.com/digi-serve/appbuilder_platform_service/releases)

# AppBuilder Platform Service
Common AppBuilder server-side platform used by various AB Services.

## Pull Requests
Pull Requests should be tagged with a label `major`, `minor` or `patch`. Use `major` for breaking changes, `minor` for new features, or `patch` for bug fixes. To merge without creating a release a `no_release` tag can be added instead.

:pencil: In the pull request body add release notes between these tags:
```md
<!-- #release_notes -->

<!-- /release_notes --> 
```
Anything between those 2 lines will be used as release notes when creating a version.

### When merged:
 - A new version will be created using semantic versioning
 - The version will be updated in `package.json`
 - A new tag and release will be created on GitHub
 - Workflows in dependant A Services will be triggered to build new versions using the updated platform.
