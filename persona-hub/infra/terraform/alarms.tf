resource "aws_sns_topic" "alerts" {
  name              = "${local.name}-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_sns_email
}

# MCP 5xx rate > 1% (5-minute window)
resource "aws_cloudwatch_metric_alarm" "mcp_5xx_rate" {
  alarm_name          = "${local.name}-mcp-5xx-rate-gt-1pct"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "rate"
    expression  = "IF(req > 0, 100 * err / req, 0)"
    label       = "MCP 5xx %"
    return_data = true
  }
  metric_query {
    id = "err"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.this.arn_suffix
        TargetGroup  = aws_lb_target_group.svc["mcp"].arn_suffix
      }
    }
  }
  metric_query {
    id = "req"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.this.arn_suffix
        TargetGroup  = aws_lb_target_group.svc["mcp"].arn_suffix
      }
    }
  }
}

# p95 latency > 1s, per service
resource "aws_cloudwatch_metric_alarm" "p95_latency" {
  for_each            = local.services
  alarm_name          = "${local.name}-${each.key}-p95-gt-1s"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = aws_lb.this.arn_suffix
    TargetGroup  = aws_lb_target_group.svc[each.key].arn_suffix
  }
}

# Permission test failure: CI/deploy pipeline and scheduled synthetic permission probe
# publish PersonaHub/PermissionTestFailures (see README). Any failure alarms.
resource "aws_cloudwatch_metric_alarm" "permission_test_failure" {
  alarm_name          = "${local.name}-permission-test-failure"
  namespace           = "PersonaHub"
  metric_name         = "PermissionTestFailures"
  dimensions          = { Environment = var.env }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
