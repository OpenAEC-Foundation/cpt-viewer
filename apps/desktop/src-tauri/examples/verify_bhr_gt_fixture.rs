fn main() -> Result<(), Box<dyn std::error::Error>> {
    let xml = include_str!("../tests/fixtures/bhr-gt-minimal.xml");
    let document = bro_xml::parse_bhr_gt(xml)?;
    assert_eq!(document.common.bro_id, "BHR000000000001");
    assert_eq!(document.intervals.len(), 2);
    println!(
        "validated {} with {} intervals",
        document.common.bro_id,
        document.intervals.len()
    );
    Ok(())
}
