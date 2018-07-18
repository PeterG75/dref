import mongoose from 'mongoose'
import { Router } from 'express'
import { check, validationResult } from 'express-validator/check'
import * as iptables from '../utils/iptables'

const router = Router()
const ARecord = mongoose.model('ARecord')

// This should be re-written as a proper REST API
router.post('/', [
  check('domain').matches(/^([a-zA-Z0-9][a-zA-Z0-9-_]*\.)*[a-zA-Z0-9]*[a-zA-Z0-9-_]*[[a-zA-Z0-9]+$/),
  check('address').optional().matches(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/),
  check('port').optional().isInt({min: 1, max: 65535}),
  check('rebind').optional().isBoolean()
], function (req, res, next) {
  const errors = validationResult(req)

  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() })
  }

  console.log('dref: POST ARecord\n' + JSON.stringify(req.body, null, 4))

  const record = {domain: req.body.domain}
  if (typeof req.body.address !== 'undefined') record.address = req.body.address
  if (typeof req.body.port !== 'undefined') record.port = req.body.port
  if (typeof req.body.rebind !== 'undefined') record.rebind = req.body.rebind

  ARecord.findOneAndUpdate({
    domain: req.body.domain
  }, record, { upsert: true, new: true }, function (err, doc) {
    if (err) {
      console.log(err)
      return res.status(400).send()
    }

    const ipv4Match = req.ip.match(/::ffff:(\d{0,3}.\d{0,3}.\d{0,3}.\d{0,3})/)
    if (!ipv4Match) {
      console.log(`source IP ${req.ip} doesn't appear to be IPv4, can't manipulate iptables and fast-rebind not available`)
      return res.status(204).send()
    }

    // if rebind is set to true, we INSERT a REDIRECT rule to port 1 (closed, so essentially blocking)
    // otherwise we DELETE any existing REDIRECT rules (unbind, allowing access to API)
    const ipv4 = ipv4Match[1]
    let command = iptables.Command.DELETE
    if (req.body.rebind) command = iptables.Command.INSERT

    iptables.execute({
      table: iptables.Table.NAT,
      command: command,
      chain: iptables.Chain.PREROUTING,
      target: iptables.Target.REDIRECT,
      fromPort: doc.port,
      toPort: 1,
      srcAddress: ipv4
    }).then(status => {
      if (status) return res.status(204).send()
      return res.status(400).send()
    })
  })
})

export default router
