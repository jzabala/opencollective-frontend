import React from 'react';
import PropTypes from 'prop-types';
import { get } from 'lodash';
import { FormattedMessage } from 'react-intl';
import { graphql } from 'react-apollo';
import gql from 'graphql-tag';

import { getStripe } from '../lib/stripe';
import MessageBox from '../components/MessageBox';
import Container from '../components/Container';
import { withUser } from '../components/UserProvider';
import AuthenticatedPage from '../components/AuthenticatedPage';

/**
 * Main contribution flow entrypoint. Render all the steps from contributeAs
 * to payment.
 */
class ConfirmOrderPage extends React.Component {
  static getInitialProps({ query }) {
    return { id: parseInt(query.id) };
  }

  static SUBMITTING = 1;
  static SUCCESS = 2;
  static ERROR = 3;

  static propTypes = {
    /** OrderId */
    id: PropTypes.number.isRequired,
    /** @ignore from graphql */
    confirmOrder: PropTypes.func.isRequired,
    /** @ignore from withUser */
    loadingLoggedInUser: PropTypes.bool.isRequired,
    /** @ignore from withUser */
    LoggedInUser: PropTypes.object,
  };

  state = {
    status: ConfirmOrderPage.SUBMITTING,
    isRequestSent: false,
    error: null,
  };

  componentDidMount() {
    if (!this.props.loadingLoggedInUser && this.props.LoggedInUser) {
      return this.triggerRequest();
    }
  }

  componentDidUpdate() {
    if (!this.state.isRequestSent && !this.props.loadingLoggedInUser && this.props.LoggedInUser) {
      return this.triggerRequest();
    }
  }

  async triggerRequest() {
    try {
      this.setState({ isRequestSent: true });
      const res = await this.props.confirmOrder(this.props.id);
      const orderConfirmed = res.data.confirmOrder;
      if (orderConfirmed.stripeError) {
        this.handleStripeError(orderConfirmed);
      } else {
        this.setState({ status: ConfirmOrderPage.SUCCESS });
      }
    } catch (e) {
      const error = get(e, 'graphQLErrors.0') || e;
      this.setState({ status: ConfirmOrderPage.ERROR, error: error.message });
    }
  }

  handleStripeError = async ({ id, stripeError: { message, account, response } }) => {
    if (!response) {
      this.setState({ status: ConfirmOrderPage.ERROR, error: message });
      return;
    }
    if (response.paymentIntent) {
      const stripe = await getStripe(null, account);
      const result = await stripe.handleCardAction(response.paymentIntent.client_secret);
      if (result.error) {
        this.setState({ status: ConfirmOrderPage.ERROR, error: result.error.message });
      }
      if (result.paymentIntent && result.paymentIntent.status === 'requires_confirmation') {
        this.triggerRequest({ id });
      }
    }
  };

  confirmOrder = async order => {
    this.setState({ status: ConfirmOrderPage.SUBMITTING, error: null });

    try {
      const res = await this.props.confirmOrder(order);
      const orderConfirmed = res.data.confirmOrder;
      if (orderConfirmed.stripeError) {
        this.handleStripeError(orderConfirmed);
      } else {
        this.handleSuccess(orderConfirmed);
      }
    } catch (e) {
      this.setState({ status: ConfirmOrderPage.ERROR, error: e.message });
    }
  };

  render() {
    const { status, error } = this.state;

    return (
      <AuthenticatedPage title="Order confirmation">
        <Container
          display="flex"
          py={[5, 6]}
          px={2}
          flexDirection="column"
          alignItems="center"
          background="linear-gradient(180deg, #EBF4FF, #FFFFFF)"
        >
          {status === ConfirmOrderPage.SUBMITTING && (
            <MessageBox type="info" isLoading>
              <FormattedMessage id="Order.Confirm.Processing" defaultMessage="Confirming your payment method…" />
            </MessageBox>
          )}
          {status === ConfirmOrderPage.SUCCESS && (
            <MessageBox mb={3} type="success" withIcon>
              <FormattedMessage
                id="Order.Confirm.Success"
                defaultMessage="Your payment method has now been confirmed and the payment successfully went through."
              />
            </MessageBox>
          )}
          {status === ConfirmOrderPage.ERROR && (
            <MessageBox type="error" withIcon>
              {error}
            </MessageBox>
          )}
        </Container>
      </AuthenticatedPage>
    );
  }
}

export const addConfirmOrderMutation = graphql(
  gql`
    mutation confirmOrder($order: ConfirmOrderInputType!) {
      confirmOrder(order: $order) {
        id
        status
        stripeError {
          message
          account
          response
        }
        transactions {
          id
        }
      }
    }
  `,
  {
    props: ({ mutate }) => ({
      confirmOrder: id => mutate({ variables: { order: { id } } }),
    }),
  },
);

export default addConfirmOrderMutation(withUser(ConfirmOrderPage));
