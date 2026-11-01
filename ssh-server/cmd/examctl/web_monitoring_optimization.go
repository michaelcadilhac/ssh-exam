package main

import (
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"fmt"
	"unicode/utf8"
)

func validateMonitoringOptimization(raw json.RawMessage) error {
	keys := []string{"status", "eligible", "frames", "converted_frames", "remaining_frames", "segments", "source_bytes", "video_bytes", "verified_at", "error"}
	var fields map[string]json.RawMessage
	invalid := errors.New("monitoring optimization projection is unavailable or inconsistent; inspect matching gateway/CLI versions")
	if core.DecodeMonitoringExportObject(raw, &fields, keys) != nil {
		return invalid
	}
	var value struct {
		Status      string  `json:"status"`
		Eligible    *bool   `json:"eligible"`
		Frames      *int64  `json:"frames"`
		Converted   *int64  `json:"converted_frames"`
		Remaining   *int64  `json:"remaining_frames"`
		Segments    *int64  `json:"segments"`
		SourceBytes *int64  `json:"source_bytes"`
		VideoBytes  *int64  `json:"video_bytes"`
		VerifiedAt  *int64  `json:"verified_at"`
		Error       *string `json:"error"`
	}
	if json.Unmarshal(raw, &value) != nil || value.Eligible == nil {
		return invalid
	}
	switch value.Status {
	case "not-queued", "pending", "running", "retry", "paused", "complete", "deleted", "ineligible":
	default:
		return invalid
	}
	for _, number := range []*int64{value.Frames, value.Converted, value.Remaining, value.Segments, value.SourceBytes, value.VideoBytes} {
		if number == nil || *number < 0 || *number > core.MonitoringExportSafeInteger {
			return invalid
		}
	}
	if *value.Converted > *value.Frames || *value.Remaining != *value.Frames-*value.Converted || (value.VerifiedAt != nil && (*value.VerifiedAt < 0 || *value.VerifiedAt > core.MonitoringExportSafeInteger)) || (value.Error != nil && utf8.RuneCountInString(*value.Error) > 80) {
		return invalid
	}
	return nil
}

func checkMonitoringOptimizationSupport(c core.Config, operation string, body any) error {
	if operation != "monitoring.optimize" {
		return nil
	}
	input, ok := body.(map[string]any)
	if !ok || input["id"] == nil {
		return errors.New("optimization needs an explicit attempt; no optimization request sent")
	}
	query := map[string]any{"id": input["id"]}
	result, err := core.ManagementCall(c, "monitoring.show", query, core.ManagementID())
	if err != nil {
		return fmt.Errorf("verify optimization support using authorized monitoring.show: %w; no optimization request sent", err)
	}
	if err := validateMonitoringResult("monitoring.show", query, result.Result); err != nil {
		return fmt.Errorf("verify optimization support: %w; no optimization request sent", err)
	}
	var shown struct {
		Capabilities []string `json:"capabilities"`
	}
	if json.Unmarshal(result.Result, &shown) == nil {
		for _, capability := range shown.Capabilities {
			if capability == "monitoring-optimization-v1" {
				return nil
			}
		}
	}
	return errors.New("gateway cannot confirm monitoring optimization support; update and authorize the web server before using optimize; no optimization request sent")
}
