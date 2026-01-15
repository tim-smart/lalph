{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        # allow unfree
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            corepack
            nodejs
          ];
        };

        # The Docker image package
        packages.lalph = pkgs.dockerTools.buildImage {
          name = "lalph-image";
          tag = "latest";
          copyToRoot = pkgs.buildEnv {
            name = "image-root";
            paths = with pkgs; [
              claude-code
              curl
              direnv
              fd
              gnumake
              gnused
              gnugrep
              nodejs
              opencode
              ripgrep
              wget
            ];
            pathsToLink = ["/bin"];
          };
        };
      }
    );
}
