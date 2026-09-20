fn main() {
    match faultline_replay::generator::generate() {
        Ok(report) => println!(
            "{}",
            serde_json::to_string_pretty(&report).expect("report serialization")
        ),
        Err(error) => {
            eprintln!("generation failed: {error}");
            std::process::exit(1);
        }
    }
}
