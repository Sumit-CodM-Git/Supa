import Foundation
import AVFoundation
import Vision

// The Python caller validates the input path before invoking this helper.
struct Person: Codable {
    let x: Double
    let y: Double
    let area: Double
}
struct Sample: Codable {
    let time: Double
    let people: [Person]
}
struct Result: Codable {
    let width: Int
    let height: Int
    let samples: [Sample]
}

do {
    guard CommandLine.arguments.count == 2 else {
        throw NSError(domain: "PortraitTracking", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected one local video path."])
    }
    let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
    guard let videoTrack = asset.tracks(withMediaType: .video).first else {
        throw NSError(domain: "PortraitTracking", code: 2, userInfo: [NSLocalizedDescriptionKey: "The file has no video track."])
    }
    // Container metadata tracks can be longer than a trimmed video stream.
    let duration = CMTimeGetSeconds(videoTrack.timeRange.duration)
    guard duration.isFinite && duration > 0 else {
        throw NSError(domain: "PortraitTracking", code: 2, userInfo: [NSLocalizedDescriptionKey: "Video duration is unavailable."])
    }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.1, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
    let first = try generator.copyCGImage(at: .zero, actualTime: nil)
    let width = first.width
    let height = first.height
    generator.maximumSize = CGSize(width: 640, height: 640)
    let step = max(0.4, duration / 9000)
    var samples: [Sample] = []
    var time = 0.0
    var decoded = 0
    while time < duration {
        try autoreleasepool {
            let image: CGImage
            do {
                image = try generator.copyCGImage(at: CMTime(seconds: time, preferredTimescale: 600), actualTime: nil)
            } catch {
                samples.append(Sample(time: time, people: []))
                return
            }
            decoded += 1
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            let faces = VNDetectFaceRectanglesRequest()
            try handler.perform([faces])
            var boxes = (faces.results ?? []).filter { $0.confidence >= 0.5 }.map { $0.boundingBox }
            if boxes.isEmpty {
                let humans = VNDetectHumanRectanglesRequest()
                humans.upperBodyOnly = false
                try handler.perform([humans])
                boxes = (humans.results ?? []).filter { $0.confidence >= 0.5 }.map { $0.boundingBox }
            }
            let people = boxes.map { rect in
                Person(x: Double(rect.midX), y: Double(1 - rect.midY), area: Double(rect.width * rect.height))
            }
            samples.append(Sample(time: time, people: people))
        }
        time += step
    }
    guard decoded > 0 else {
        throw NSError(domain: "PortraitTracking", code: 3, userInfo: [NSLocalizedDescriptionKey: "No video frames could be analyzed."])
    }
    let data = try JSONEncoder().encode(Result(width: width, height: height, samples: samples))
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
