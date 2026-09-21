# OLL Rust runtime

Platform-independent migration of OLL runtime behavior. This crate currently contains the numeric expression evaluator; it is not yet a complete course player. The TypeScript protocol implementation remains the compatibility reference.

Run `cargo test --locked --manifest-path crates/oll-runtime/Cargo.toml`.

Expression semantics preserve right-associative powers, unary precedence, supported functions, Unicode operator normalization, finite-result checks, and JavaScript rounding of negative ties. Error wording is not a compatibility guarantee. Renderer, audio, storage and clock are platform responsibilities.
