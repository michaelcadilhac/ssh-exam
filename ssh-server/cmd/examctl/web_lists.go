package main

import (
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
)

// Only public metadata listings use this collector. Internal capability probes,
// mutations and byte-oriented replay/export keep their original bounded calls.
func webListKey(operation string) string {
	switch operation {
	case "exams.list":
		return "exams"
	case "students.list":
		return "students"
	case "attempts.list":
		return "attempts"
	case "grants.list":
		return "grants"
	case "templates.list":
		return "sources"
	case "administrators.list":
		return "administrators"
	case "alerts.list":
		return "alerts"
	case "monitoring.list", "monitoring.purges":
		return "entries"
	case "grants.issue-list":
		return "rows"
	}
	return ""
}

func webListLimit(flags *flag.FlagSet, limit int) int {
	total := 0
	flags.Visit(func(f *flag.Flag) {
		if f.Name == "limit" {
			total = limit
		}
	})
	return total
}

// Each signed page is validated against its own request, before merging. An
// explicit limit counts matching output rows, not scanned server rows. No caller
// publishes output until all requested pages succeed. There is no snapshot claim.
func collectWebList(c core.Config, operation string, body map[string]any, request string, total int, username string, scripting bool) (core.ManagementResult, []map[string]any, error) {
	key := webListKey(operation)
	var result core.ManagementResult
	rows := make([]map[string]any, 0)
	if key == "" {
		return result, rows, errors.New("unsupported metadata listing")
	}
	page := map[string]any{}
	for k, v := range body {
		page[k] = v
	}
	pageSize, ok := page["limit"].(int)
	if !ok || pageSize < 1 {
		return result, rows, errors.New("missing bounded list request")
	}
	cursors, identities := map[string]bool{}, map[string]bool{}
	var merged map[string]any
	var scanned int64
	for pages := 0; ; pages++ {
		if pages >= scriptExportRows {
			return result, nil, errors.New("list exceeds10000 requests; narrow the selection; no partial output")
		}
		page["limit"] = pageSize
		if total > 0 && total-len(rows) < pageSize {
			page["limit"] = total - len(rows)
		}
		if request == "" {
			request = core.ManagementID()
		}
		r, err := scriptValidatedCall(c, operation, page, request)
		if err != nil {
			return r, nil, err
		}
		result = r
		var value map[string]any
		if decodeScriptJSON(r.Result, &value) != nil {
			return r, nil, errors.New("invalid list result")
		}
		encoded, err := json.Marshal(value[key])
		var part []map[string]any
		if value[key] == nil || err != nil || decodeScriptJSON(encoded, &part) != nil || len(part) > page["limit"].(int) {
			return r, nil, errors.New("list reply lacks its bounded typed collection")
		}
		if scripting || operation == "attempts.list" {
			if err := validateScriptListRows(operation, page, part); err != nil {
				return r, nil, err
			}
		}
		for _, row := range part {
			identity := webListIdentity(operation, row)
			if identity == "" || identities[identity] {
				return r, nil, errors.New("missing/duplicate identity in listing; retry a fresh list")
			}
			identities[identity] = true
			if username != "" && row["username"] != username {
				continue
			}
			rows = append(rows, row)
		}
		next, exists := value["next"]
		if !exists {
			return r, nil, errors.New("list reply lacks its next cursor")
		}
		if next != nil {
			switch v := next.(type) {
			case string:
				if v == "" || operation == "monitoring.list" || operation != "grants.issue-list" && v <= stringField(page, "after") {
					return r, nil, errors.New("invalid list cursor")
				}
			case json.Number:
				n, e := v.Int64()
				if operation != "monitoring.list" || e != nil || n <= 0 || n > catalogSafeInteger {
					return r, nil, errors.New("invalid numeric list cursor")
				}
			default:
				return r, nil, errors.New("invalid list cursor type")
			}
			cursor := fmt.Sprint(next)
			if cursor == fmt.Sprint(page["after"]) || cursors[cursor] {
				return r, nil, errors.New("non-advancing/repeated list cursor; no complete result inferred")
			}
			cursors[cursor] = true
		}
		if operation == "monitoring.list" {
			// Pin the first signed inventory watermark for every later page.
			if _, exists := page["through"]; !exists {
				page["through"] = value["through"]
			}
		}
		if merged == nil {
			merged = value
		}
		if operation == "attempts.list" {
			if n, ok := value["scanned"].(json.Number); ok {
				count, err := n.Int64()
				if err != nil || count < 0 || count > int64(page["limit"].(int)) {
					return r, nil, errors.New("invalid scanned-row count")
				}
				scanned += count
				merged["scanned"] = scanned
			}
		}
		merged[key], merged["next"] = rows, next
		encoded, err = json.Marshal(merged)
		if err != nil || len(rows) > scriptExportRows || len(encoded) > scriptExportBytes {
			return r, nil, errors.New("complete list exceeds10000 rows/32MiB; narrow the selection; no partial output")
		}
		if next == nil || total > 0 && len(rows) >= total {
			break
		}
		page["after"] = next
		request = "" // A new signed read, never reuse an ID for a different page.
	}
	result.Result, _ = json.Marshal(merged)
	return result, rows, nil
}

func webListIdentity(operation string, row map[string]any) string {
	key := "id"
	switch operation {
	case "exams.list":
		if exam, ok := row["exam"].(map[string]any); ok {
			id, _ := exam["id"].(string)
			return id
		}
		return ""
	case "students.list", "administrators.list":
		key = "username"
	case "templates.list":
		name, _ := row["name"].(string)
		hash, _ := row["hash"].(string)
		if name == "" || hash == "" {
			return ""
		}
		return name + "@" + hash
	case "monitoring.list":
		key = "cursor"
	}
	if value, ok := row[key].(string); ok {
		return value
	}
	if value, ok := row[key].(json.Number); ok {
		return value.String()
	}
	return ""
}
