#![cfg_attr(not(windows), allow(unused_imports))]

#[cfg(windows)]
fn main() {
    use std::{
        io::{Read, Write},
        time::Duration,
    };

    let mut mode = [0_u8; 1];
    if std::io::stdin().read_exact(&mut mode).is_err() {
        std::process::exit(64);
    }
    match mode[0] {
        0 => std::process::abort(),
        1 => panic!("test-only worker panic"),
        2 => loop {
            std::thread::sleep(Duration::from_secs(1));
        },
        3 => {
            let mut value = 1_u64;
            loop {
                value = value.wrapping_mul(6364136223846793005).wrapping_add(1);
                std::hint::black_box(value);
            }
        }
        4 => {
            let mut values = Vec::new();
            loop {
                values.push(vec![0xa5_u8; 16 * 1024 * 1024]);
                std::hint::black_box(&values);
            }
        }
        5 => {
            let block = vec![b'x'; 64 * 1024];
            let mut out = std::io::stdout().lock();
            loop {
                if out.write_all(&block).is_err() {
                    break;
                }
            }
        }
        6 => {
            let block = vec![b'e'; 64 * 1024];
            let mut out = std::io::stderr().lock();
            loop {
                if out.write_all(&block).is_err() {
                    break;
                }
            }
        }
        7 => {
            let _ = std::io::stdout().write_all(b"FLTWORK1");
        }
        8 => {
            let mut frame =
                faultline_replay::ipc::encode_frame(faultline_replay::ipc::RESPONSE_KIND, b"{}", 2)
                    .unwrap();
            frame.push(1);
            let _ = std::io::stdout().write_all(&frame);
        }
        9 => {
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .arg("--child")
                .spawn();
            std::process::exit(if child.is_err() { 77 } else { 78 });
        }
        10 => {
            let frame = faultline_replay::ipc::encode_frame(
                faultline_replay::ipc::RESPONSE_KIND,
                b"{malformed",
                10,
            )
            .unwrap();
            let _ = std::io::stdout().write_all(&frame);
        }
        11 => {}
        _ => std::process::exit(65),
    }
}

#[cfg(not(windows))]
fn main() {
    std::process::exit(78);
}
